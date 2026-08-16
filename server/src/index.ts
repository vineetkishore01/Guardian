import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectHostTelemetry } from './collectors/host.js';
import { collectDiskUsage } from './collectors/disk.js';
import { fetchContainers, fetchDockerSystemDf, pruneDockerImages } from './collectors/docker.js';
import { runServiceProbes } from './prober.js';
import {
  loadUserConfig,
  updateContainerConfig,
  addOrUpdateCustomApp,
  deleteCustomApp,
  updateSettings,
  getDefaultIconPreset,
} from './store.js';
import { globalHistory } from './ringbuffer.js';
import { FullDashboardState, ContainerItem, HostTelemetry } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json());

// SSE Clients Registry
const sseClients = new Set<Response>();

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

async function assembleFullState(): Promise<FullDashboardState> {
  const hostBase = collectHostTelemetry();
  const disks = collectDiskUsage();
  const host: HostTelemetry = { ...hostBase, disks };

  const rawContainers = await fetchContainers();
  const config = loadUserConfig();
  const dockerDf = await fetchDockerSystemDf();

  // Merge custom metadata into containers
  const containers: ContainerItem[] = rawContainers.map((c) => {
    const userMeta = config.containers[c.name] || {};
    const preset = getDefaultIconPreset(c.name);

    const displayName = userMeta.displayName || preset?.displayName || c.name;
    const iconUrl = userMeta.iconUrl || preset?.icon || undefined;
    const category = userMeta.category || preset?.category || (c.composeProject || 'General');

    return {
      ...c,
      displayName,
      iconUrl,
      customUrl: userMeta.customUrl,
      category,
      hidden: userMeta.hidden ?? false,
      pinned: userMeta.pinned ?? false,
      order: userMeta.order,
    };
  });

  const lanIp = config.settings.lanIp || '192.168.0.26';
  const probes = await runServiceProbes(lanIp);

  // Add history point
  const primaryThermal = host.thermals.find((t) => t.label.includes('pkg') || t.label.includes('cpu')) || host.thermals[0];
  const primaryNet = host.network.find((n) => n.name === 'eno1') || host.network[0];

  globalHistory.push({
    timestamp: Date.now(),
    cpu: host.cpu.usagePercent,
    ram: host.memory.usedPercent,
    netRx: primaryNet ? primaryNet.rxBytesPerSec : 0,
    netTx: primaryNet ? primaryNet.txBytesPerSec : 0,
    temp: primaryThermal ? primaryThermal.tempC : 45,
  });

  return {
    host,
    containers,
    dockerDf,
    probes,
    config,
    history: globalHistory.getHistory(),
  };
}

// REST API Endpoints
app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const state = await assembleFullState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// SSE Live Stream Endpoint
app.get('/api/live', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);

  // Send initial state immediately
  try {
    const state = await assembleFullState();
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  } catch {
    // Ignore initial error
  }

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Config Endpoints
app.get('/api/config', (req: Request, res: Response) => {
  res.json(loadUserConfig());
});

app.post('/api/config/settings', (req: Request, res: Response) => {
  const updated = updateSettings(req.body);
  res.json(updated);
});

app.post('/api/containers/:name/custom', (req: Request, res: Response) => {
  const name = String(req.params.name);
  const updated = updateContainerConfig(name, req.body);
  res.json(updated);
});

app.post('/api/custom-apps', (req: Request, res: Response) => {
  const appBookmark = req.body;
  if (!appBookmark.id) {
    appBookmark.id = `custom_${Date.now()}`;
  }
  const updated = addOrUpdateCustomApp(appBookmark);
  res.json(updated);
});

app.delete('/api/custom-apps/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const updated = deleteCustomApp(id);
  res.json(updated);
});

// Docker Prune Action
app.post('/api/docker/prune', async (req: Request, res: Response) => {
  try {
    const result = await pruneDockerImages();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Probes Refresh
app.post('/api/probes/refresh', async (req: Request, res: Response) => {
  try {
    const config = loadUserConfig();
    const probes = await runServiceProbes(config.settings.lanIp, true);
    res.json(probes);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Serve frontend static build files if available
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    }
  });
}

// Background polling loop for live push
let isPolling = false;
setInterval(async () => {
  if (sseClients.size === 0 || isPolling) return;
  isPolling = true;
  try {
    const state = await assembleFullState();
    broadcastSSE(state);
  } catch (err) {
    console.error('[Polling Error]:', (err as Error).message);
  } finally {
    isPolling = false;
  }
}, 15000);

app.listen(PORT, HOST, () => {
  console.log(`🚀 Guardian server listening on http://${HOST}:${PORT}`);
  console.log(`   LAN access: http://192.168.0.26:${PORT}`);
  console.log(`   Tailscale access: http://100.94.238.9:${PORT}`);
});
