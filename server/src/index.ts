import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectHostTelemetry, isHostDataLive } from './collectors/host.js';
import { collectDiskUsage } from './collectors/disk.js';
import {
  fetchContainers,
  fetchDockerSystemDf,
  pruneDockerImages,
  isDockerLive,
} from './collectors/docker.js';
import { runServiceProbes } from './prober.js';
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
import { FullDashboardState, ContainerItem, HostTelemetry } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.BIND_HOST || '0.0.0.0';

const MIN_INTERVAL_MS = 5000;
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
  const host: HostTelemetry = { ...hostBase, disks };

  const config = loadUserConfig();
  const [rawContainers, dockerDf, probes] = await Promise.all([
    fetchContainers(),
    fetchDockerSystemDf(),
    runServiceProbes(config.settings.lanIp),
  ]);

  const containers: ContainerItem[] = rawContainers.map((c) => {
    const userMeta = config.containers[c.name] || {};
    const preset = getDefaultIconPreset(c.name);

    return {
      ...c,
      displayName: userMeta.displayName || preset?.displayName || c.name,
      iconUrl: userMeta.iconUrl || preset?.icon || undefined,
      customUrl: userMeta.customUrl,
      category: userMeta.category || preset?.category || c.composeProject || 'General',
      hidden: userMeta.hidden ?? false,
      pinned: userMeta.pinned ?? false,
      order: userMeta.order,
    };
  });

  const primaryThermal =
    host.thermals.find((t) => /pkg|package|cpu|tctl|core/i.test(t.label)) || host.thermals[0];
  const primaryNet =
    host.network.find((n) => !/^(docker|veth|br-|virbr|lo|tun|tap|wg)/.test(n.name)) ||
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

  const state: FullDashboardState = {
    host,
    containers,
    dockerDf,
    probes,
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
  const configured = (loadUserConfig().settings.refreshIntervalSec || 15) * 1000;
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
      .catch((err) => console.error('[Guardian] Sampling failed:', (err as Error).message));
  }, intervalMs);

  console.log(`[Guardian] Sampling every ${intervalMs / 1000}s`);
}

/* ----------------------------- API ----------------------------- */

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    sseClients: sseClients.size,
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

app.post('/api/docker/prune', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pruneDockerImages();
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
    const probes = await runServiceProbes(config.settings.lanIp, true);
    if (latestState) latestState = { ...latestState, probes };
    res.json(probes);
  } catch (err) {
    next(err);
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
  app.use(express.static(clientDistPath, { index: false, maxAge: '1h' }));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  console.warn(`[Guardian] No client build at ${clientDistPath}; serving API only.`);
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Guardian] Request failed:', err.message);
  res.status(500).json({ error: err.message });
});

/* ----------------------------- Boot ----------------------------- */

const server = app.listen(PORT, HOST, () => {
  console.log(`[Guardian] Listening on http://${HOST}:${PORT}`);
  scheduleSampling();
  sampleOnce().catch((err) =>
    console.error('[Guardian] Initial sample failed:', (err as Error).message)
  );
});

function shutdown(signal: string) {
  console.log(`[Guardian] ${signal} received, shutting down.`);
  if (sampleTimer) clearInterval(sampleTimer);
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
