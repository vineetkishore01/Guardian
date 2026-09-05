import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectHostTelemetry, isHostDataLive } from './collectors/host.js';
import { collectDiskUsage } from './collectors/disk.js';
import { collectGpuTelemetry } from './collectors/gpu.js';
import { collectWanTelemetry } from './collectors/wan.js';
import { runSpeedtest, getSpeedtestHistory, getCurrentSpeedtestProgress } from './speedtest.js';
import { getAppWidgetData } from './integrations/index.js';
import {
  fetchContainers,
  fetchDockerSystemDf,
  pruneDockerImages,
  fetchContainerLogs,
  restartContainer,
  stopContainer,
  startContainer,
  updateAndRecreateContainer,
  isDockerLive,
  stopContainerStatsStreams,
  containerStreamCount,
} from './collectors/docker.js';
import { collectTopProcesses } from './collectors/processes.js';
import { telemetryHistory, METRIC_KEYS } from './history.js';
import { diskTrends } from './disktrend.js';
import { logger, installCrashHandlers } from './logger.js';
import { getPowerCapability, executePowerAction, PowerError } from './power.js';
import { runServiceProbes, buildProbeTargets } from './prober.js';
import {
  loadUserConfig,
  updateContainerConfig,
  addOrUpdateCustomApp,
  deleteCustomApp,
  updateSettings,
  getDefaultIconPreset,
  sanitizeContainerOverride,
  sanitizeCustomApp,
  sanitizeSettings,
} from './store.js';
import { globalHistory } from './ringbuffer.js';
import {
  FullDashboardState,
  ContainerItem,
  HostTelemetry,
  MetricKey,
  HistoryRange,
  LogLevel,
  PowerAction,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.BIND_HOST || '0.0.0.0';

const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 300000;
const SSE_HEARTBEAT_MS = 20000;

app.use(cors());
app.use(express.json({ limit: '256kb' }));

const sseClients = new Set<Response>();

/*
 * Telemetry sampling is owned exclusively by the loop below.
 *
 * The collectors for CPU and network are *stateful*: each reads a kernel
 * counter and diffs it against the previous read. Previously every
 * `/api/status` request, every SSE connection and the background timer all
 * called the collectors directly. Two calls close together meant the second saw
 * a near-zero delta, so a page load right after a tick reported ~0% CPU and 0
 * B/s of traffic. Worse, each of those calls also appended a history point, so
 * the sparklines were sampled at wildly uneven intervals.
 *
 * Now a single loop samples on a fixed cadence and publishes an immutable
 * snapshot; every reader serves that snapshot.
 */
let latestState: FullDashboardState | null = null;
let sampling: Promise<FullDashboardState> | null = null;
let sampleTimer: NodeJS.Timeout | null = null;
let currentIntervalMs = 0;

async function sampleTelemetry(): Promise<FullDashboardState> {
  const hostBase = collectHostTelemetry();
  const disks = collectDiskUsage();

  const config = loadUserConfig();
  const [rawContainers, dockerDf, gpu, wan] = await Promise.all([
    fetchContainers(),
    fetchDockerSystemDf(),
    collectGpuTelemetry().catch(() => []),
    collectWanTelemetry().catch(() => ({})),
  ]);

  const host: HostTelemetry = {
    ...hostBase,
    disks,
    gpu: gpu && gpu.length > 0 ? gpu : undefined,
    wan: wan && Object.keys(wan).length > 0 ? wan : undefined,
  };

  const containerPromises = rawContainers.map(async (c) => {
    const userMeta = config.containers[c.name] || {};
    const preset = getDefaultIconPreset(c.name);

    const baseContainer: ContainerItem = {
      ...c,
      displayName: userMeta.displayName || preset?.displayName || c.name,
      iconUrl: userMeta.iconUrl || preset?.icon || undefined,
      customUrl: userMeta.customUrl,
      category: userMeta.category || preset?.category || c.composeProject || 'General',
      hidden: userMeta.hidden ?? false,
      pinned: userMeta.pinned ?? false,
      order: userMeta.order,
      integration: userMeta.integration,
      integrationConfig: userMeta.integrationConfig,
    };

    // Attach in-card widget if available
    const widget = await getAppWidgetData(baseContainer).catch(() => null);
    if (widget) {
      baseContainer.widget = widget;
    }
    return baseContainer;
  });

  const containers = await Promise.all(containerPromises);

  // Also enrich custom apps with widgets
  await Promise.all(
    config.customApps.map(async (app) => {
      const widget = await getAppWidgetData(app).catch(() => null);
      if (widget) {
        app.widget = widget;
      }
    })
  );

  // Probe targets are derived from the containers we just discovered, so a new
  // service is covered the moment it starts.
  const probes = await runServiceProbes(
    config.settings.lanIp,
    buildProbeTargets(containers, config.customApps)
  );

  const primaryThermal =
    host.thermals.find((t) => /pkg|package|cpu|tctl|core/i.test(t.label)) || host.thermals[0];
  const primaryNet =
    host.network.find((n) => !/^(docker|veth|br-|virbr|lo|tun|tap|wg|tailscale|zt|ham|nebula|cni|flannel|kube|dummy|ifb|sit|gre)/.test(n.name)) ||
    host.network[0];

  // Exactly one history point per sample, at a known cadence.
  globalHistory.push({
    timestamp: host.timestamp,
    cpu: host.cpu.usagePercent,
    ram: host.memory.usedPercent,
    netRx: primaryNet ? primaryNet.rxBytesPerSec : 0,
    netTx: primaryNet ? primaryNet.txBytesPerSec : 0,
    temp: primaryThermal ? primaryThermal.tempC : 0,
  });

  // Long-term store: same observation, retained for 30 days at falling
  // resolution. Only record what was actually measured -- an absent thermal
  // sensor must leave a gap, not a run of zeroes.
  const fullestDisk = disks.reduce<number | undefined>(
    (worst, d) => (worst === undefined || d.usedPercent > worst ? d.usedPercent : worst),
    undefined
  );
  telemetryHistory.push(host.timestamp, {
    cpu: host.cpu.usagePercent,
    ram: host.memory.usedPercent,
    swap: host.memory.swapTotalBytes > 0 ? host.memory.swapPercent : undefined,
    temp: primaryThermal?.tempC,
    netRx: primaryNet?.rxBytesPerSec,
    netTx: primaryNet?.txBytesPerSec,
    disk: fullestDisk,
  });

  // Fill trajectory per volume. Recorded every sample, but bucketed hourly
  // inside the store, so this is cheap regardless of the refresh interval.
  diskTrends.record(disks, host.timestamp);
  const trends = disks
    .map((d) => diskTrends.trendFor(d, host.timestamp))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);

  const state: FullDashboardState = {
    host,
    containers,
    dockerDf,
    probes,
    diskTrends: trends.length > 0 ? trends : undefined,
    config,
    history: globalHistory.getHistory(),
    sources: {
      host: isHostDataLive() ? 'live' : 'synthetic',
      docker: isDockerLive() ? 'live' : 'synthetic',
    },
  };

  latestState = state;
  return state;
}

/** Serialises sampling so concurrent callers share one pass over the counters. */
function sampleOnce(): Promise<FullDashboardState> {
  if (!sampling) {
    sampling = sampleTelemetry().finally(() => {
      sampling = null;
    });
  }
  return sampling;
}

/** The published snapshot, sampling on demand only if none exists yet. */
async function getState(): Promise<FullDashboardState> {
  return latestState ?? sampleOnce();
}

function broadcastSSE(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function resolveIntervalMs(): number {
  const configured = (loadUserConfig().settings.refreshIntervalSec || 5) * 1000;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, configured));
}

/** (Re)arms the sampling loop, honouring the configured refresh interval.
 *  That setting existed in the UI but nothing ever read it. */
function scheduleSampling(): void {
  const intervalMs = resolveIntervalMs();
  if (sampleTimer && intervalMs === currentIntervalMs) return;

  if (sampleTimer) clearInterval(sampleTimer);
  currentIntervalMs = intervalMs;

  sampleTimer = setInterval(() => {
    sampleOnce()
      .then((state) => {
        if (sseClients.size > 0) broadcastSSE(state);
      })
      .catch((err) => logger.error('telemetry', 'Sampling failed', err));
  }, intervalMs);

  logger.info('telemetry', `Sampling every ${intervalMs / 1000}s`);
}

/* ----------------------------- API ----------------------------- */

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    sseClients: sseClients.size,
    containerStatStreams: containerStreamCount(),
    lastSampleAt: latestState?.host.timestamp ?? null,
  });
});

app.get('/api/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getState());
  } catch (err) {
    next(err);
  }
});

app.get('/api/live', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Stops nginx from buffering the stream into oblivion behind a reverse proxy.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);

  try {
    res.write(`data: ${JSON.stringify(await getState())}\n\n`);
  } catch {
    // Client vanished before the first frame; cleanup below handles it.
  }

  // Comment frames keep idle proxies and load balancers from dropping the
  // connection between samples.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, SSE_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
});

app.get('/api/config', (_req: Request, res: Response) => {
  res.json(loadUserConfig());
});

app.post('/api/config/settings', (req: Request, res: Response) => {
  const patch = sanitizeSettings(req.body);
  if (!patch) return res.status(400).json({ error: 'Invalid settings payload' });

  const updated = updateSettings(patch);
  // A changed interval must take effect without a restart.
  scheduleSampling();
  return res.json(updated);
});

app.post('/api/containers/:name/custom', (req: Request, res: Response) => {
  const name = String(req.params.name);
  const patch = sanitizeContainerOverride(req.body);
  if (!patch) return res.status(400).json({ error: 'Invalid container override payload' });

  return res.json(updateContainerConfig(name, patch));
});

app.post('/api/custom-apps', (req: Request, res: Response) => {
  const bookmark = sanitizeCustomApp(req.body);
  if (!bookmark) {
    return res.status(400).json({ error: 'A bookmark requires a name and a url' });
  }
  return res.json(addOrUpdateCustomApp(bookmark));
});

app.delete('/api/custom-apps/:id', (req: Request, res: Response) => {
  return res.json(deleteCustomApp(String(req.params.id)));
});

app.post('/api/docker/prune', async (req: Request, res: Response, next: NextFunction) => {
  // `all` also removes tagged images no container uses; the client must ask.
  const scope = req.body?.scope === 'all' ? 'all' : 'dangling';
  try {
    const result = await pruneDockerImages(scope);
    logger.info('docker', `Pruned images (${scope})`, {
      reclaimedBytes: result.spaceReclaimedBytes,
    });
    // Reclaimed space changes the disk picture; refresh the snapshot.
    await sampleOnce();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.post('/api/probes/refresh', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = loadUserConfig();
    const probes = await runServiceProbes(
      config.settings.lanIp,
      buildProbeTargets(latestState?.containers ?? [], config.customApps),
      true
    );
    if (latestState) latestState = { ...latestState, probes };
    res.json(probes);
  } catch (err) {
    next(err);
  }
});

/* --------------------------- Metric history --------------------------- */

const VALID_RANGES: HistoryRange[] = ['1h', '6h', '24h', '7d', '30d'];

app.get('/api/history/:metric', (req: Request, res: Response) => {
  const metric = String(req.params.metric) as MetricKey;
  if (!METRIC_KEYS.includes(metric)) {
    return res.status(400).json({ error: `Unknown metric. Expected one of: ${METRIC_KEYS.join(', ')}` });
  }

  const requested = String(req.query.range || '24h') as HistoryRange;
  const range = VALID_RANGES.includes(requested) ? requested : '24h';

  return res.json({
    ...telemetryHistory.getSeries(metric, range),
    coverage: telemetryHistory.getCoverage(),
  });
});

/** Several metrics in one round trip, for a comparison view. */
app.get('/api/history', (req: Request, res: Response) => {
  const requestedRange = String(req.query.range || '24h') as HistoryRange;
  const range = VALID_RANGES.includes(requestedRange) ? requestedRange : '24h';

  const requestedMetrics = String(req.query.metrics || '')
    .split(',')
    .map((m) => m.trim())
    .filter((m): m is MetricKey => METRIC_KEYS.includes(m as MetricKey));

  const metrics = requestedMetrics.length > 0 ? requestedMetrics : METRIC_KEYS;

  res.json({
    range,
    coverage: telemetryHistory.getCoverage(),
    series: metrics.map((m) => telemetryHistory.getSeries(m, range)),
  });
});

/* ------------------------------ App logs ------------------------------ */

const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

app.get('/api/logs', (req: Request, res: Response) => {
  const level = VALID_LEVELS.includes(String(req.query.level) as LogLevel)
    ? (String(req.query.level) as LogLevel)
    : undefined;

  const limit = Number(req.query.limit);

  res.json({
    ...logger.query({
      level,
      scope: req.query.scope ? String(req.query.scope) : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      since: Number(req.query.since) || undefined,
    }),
    scopes: logger.scopes(),
  });
});

app.delete('/api/logs', (_req: Request, res: Response) => {
  logger.clear();
  res.json({ ok: true });
});

/* --------------------------- Container logs --------------------------- */

app.get('/api/containers/:id/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tail = Number(req.query.tail);
    const lines = await fetchContainerLogs(
      String(req.params.id),
      Number.isFinite(tail) ? tail : 200
    );
    res.json({ lines, tail: lines.length });
  } catch (err) {
    logger.warn('docker', 'Container log fetch failed', {
      container: String(req.params.id),
      message: (err as Error).message,
    });
    next(err);
  }
});

/* --------------------------- Container control ------------------------- */

app.post('/api/containers/:id/restart', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    await restartContainer(id);
    logger.info('docker', `Restarted container ${id}`, { requestedBy: req.ip });
    // Trigger immediate resample so status updates across SSE stream
    sampleOnce().then(broadcastSSE).catch(() => {});
    res.json({ ok: true, message: `Container ${id} restarted successfully` });
  } catch (err) {
    logger.error('docker', `Failed to restart container ${id}`, { message: (err as Error).message });
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/containers/:id/stop', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    await stopContainer(id);
    logger.info('docker', `Stopped container ${id}`, { requestedBy: req.ip });
    sampleOnce().then(broadcastSSE).catch(() => {});
    res.json({ ok: true, message: `Container ${id} stopped` });
  } catch (err) {
    logger.error('docker', `Failed to stop container ${id}`, { message: (err as Error).message });
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/containers/:id/start', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    await startContainer(id);
    logger.info('docker', `Started container ${id}`, { requestedBy: req.ip });
    sampleOnce().then(broadcastSSE).catch(() => {});
    res.json({ ok: true, message: `Container ${id} started` });
  } catch (err) {
    logger.error('docker', `Failed to start container ${id}`, { message: (err as Error).message });
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/containers/:id/update', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    logger.info('docker', `Pulling image and updating container ${id}`, { requestedBy: req.ip });
    const result = await updateAndRecreateContainer(id);
    sampleOnce().then(broadcastSSE).catch(() => {});
    res.json({
      ok: true,
      message: `Container ${id} updated to latest ${result.image} and restarted`,
      newId: result.newId,
    });
  } catch (err) {
    logger.error('docker', `Failed to update container ${id}`, { message: (err as Error).message });
    res.status(500).json({ error: (err as Error).message });
  }
});

/* --------------------------- Process telemetry ------------------------- */

app.get('/api/processes', async (req: Request, res: Response) => {
  const sortBy = req.query.sort === 'mem' ? 'mem' : req.query.sort === 'net' ? 'net' : 'cpu';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const search = req.query.search ? String(req.query.search) : undefined;

  try {
    const processes = await collectTopProcesses(sortBy, limit, search);
    res.json({ processes, count: processes.length, sortBy });
  } catch (err) {
    logger.error('telemetry', 'Failed to collect processes', { message: (err as Error).message });
    res.status(500).json({ error: (err as Error).message, processes: [] });
  }
});

/* --------------------------- Speedtest & Network ------------------------- */

app.post('/api/speedtest/run', async (_req: Request, res: Response) => {
  try {
    const result = await runSpeedtest();
    sampleOnce().then(broadcastSSE).catch(() => {});
    res.json({ ok: true, result });
  } catch (err) {
    logger.error('speedtest', 'Failed to run speedtest', { message: (err as Error).message });
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/speedtest/history', (_req: Request, res: Response) => {
  res.json({
    history: getSpeedtestHistory(),
    progress: getCurrentSpeedtestProgress(),
  });
});

app.post('/api/network/wan/refresh', async (_req: Request, res: Response) => {
  try {
    const wan = await collectWanTelemetry(true);
    sampleOnce().then(broadcastSSE).catch(() => {});
    res.json({ ok: true, wan });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ---------------------------- Power control ---------------------------- */

app.get('/api/power', (_req: Request, res: Response) => {
  res.json(getPowerCapability());
});

app.post('/api/power/:action', async (req: Request, res: Response, next: NextFunction) => {
  const action = String(req.params.action) as PowerAction;
  if (action !== 'shutdown' && action !== 'reboot') {
    return res.status(400).json({ error: 'Action must be "shutdown" or "reboot"' });
  }

  try {
    const result = await executePowerAction(
      action,
      String(req.body?.confirmation ?? ''),
      req.ip || 'unknown'
    );
    return res.json({ ok: true, action, ...result });
  } catch (err) {
    if (err instanceof PowerError) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

/*
 * Unknown /api routes must terminate here. The catch-all below used to check
 * `startsWith('/api')` and then simply not respond, leaving the request hanging
 * until the client timed out.
 */
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

/* --------------------------- Static site --------------------------- */

const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  // Hashed asset filenames are safe to cache hard and forever.
  app.use(
    express.static(clientDistPath, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite emits `name-HASH.ext`; other bundlers use `name.HASH.ext`.
        if (/[.-][0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|svg|jpe?g)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // index.html must never be cached: it is what points at the hashed bundles,
  // so a stale copy pins the browser to a previous release even after an
  // upgrade. This bit us during development -- the page kept rendering an old
  // build after a rebuild.
  app.get('*', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  logger.warn('server', `No client build at ${clientDistPath}; serving API only.`);
}

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('http', `${req.method} ${req.path} failed`, err);
  res.status(500).json({ error: err.message });
});

/* ----------------------------- Boot ----------------------------- */

// Persist logs alongside the rest of the runtime state.
const runtimeDir = fs.existsSync(process.env.DATA_DIR || '/data')
  ? process.env.DATA_DIR || '/data'
  : path.join(process.cwd(), 'data');
logger.attachFile(path.join(runtimeDir, 'logs.json'));
installCrashHandlers();

const server = app.listen(PORT, HOST, () => {
  logger.info('server', `Listening on http://${HOST}:${PORT}`);

  const power = getPowerCapability();
  logger.info(
    'power',
    power.enabled
      ? `Power controls enabled via ${power.mechanism}`
      : 'Power controls disabled',
    power.reason ? { reason: power.reason } : undefined
  );

  const coverage = telemetryHistory.getCoverage();
  logger.info('history', 'History store ready', {
    points: coverage.totalPoints,
    oldest: coverage.oldest ? new Date(coverage.oldest).toISOString() : null,
  });

  scheduleSampling();
  sampleOnce().catch((err) => logger.error('telemetry', 'Initial sample failed', err));
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('server', `${signal} received, shutting down`);
  if (sampleTimer) clearInterval(sampleTimer);

  // Close open history buckets and flush both stores before exiting, so a
  // restart does not lose the current interval.
  telemetryHistory.flushAndSave();
  diskTrends.flushAndSave();
  stopContainerStatsStreams();
  logger.save();

  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      // Already gone.
    }
  }
  sseClients.clear();
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
