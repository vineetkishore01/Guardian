import http from 'node:http';
import https from 'node:https';
import { ServiceProbeResult } from './types.js';

interface ProbeTarget {
  name: string;
  port: number;
  path: string;
  notes?: string;
}

const PROBE_TARGETS: ProbeTarget[] = [
  { name: 'CasaOS (Host)', port: 3000, path: '/', notes: 'Host Nginx' },
  { name: 'ZenNotes', port: 8001, path: '/', notes: 'Notes app' },
  { name: 'Pelagica', port: 8002, path: '/', notes: 'Web app' },
  { name: 'llm-wiki-web', port: 8080, path: '/', notes: 'AI Wiki' },
  { name: 'Trawl', port: 8191, path: '/', notes: 'FlareSolverr / Trawl' },
  { name: 'Cleanuparr', port: 11011, path: '/', notes: 'Queue cleaner' },
  { name: 'Prowlarr', port: 9696, path: '/api/v1/health', notes: 'Indexer manager' },
  { name: 'Bazarr', port: 6767, path: '/api/system/status', notes: 'Subtitles' },
  { name: 'code-server', port: 8443, path: '/', notes: 'VSCode Web' },
];

let cachedProbeResults: ServiceProbeResult[] = [];
let lastProbeTime = 0;

function probeUrl(target: ProbeTarget, hostIp: string): Promise<ServiceProbeResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const url = `http://${hostIp}:${target.port}${target.path}`;
    const req = http.get(
      url,
      {
        timeout: 3000,
        headers: { 'User-Agent': 'Guardian-Prober/1.0' },
      },
      (res) => {
        const latency = Date.now() - startTime;
        res.resume(); // Consume stream to free memory

        const code = res.statusCode || null;
        let status: ServiceProbeResult['status'] = 'up';
        if (code === 401) {
          status = 'unauthorized';
        } else if (code === 403) {
          status = 'unauthorized';
        } else if (code === 301 || code === 302 || code === 307 || code === 308) {
          status = 'redirect';
        } else if (code && code >= 200 && code < 400) {
          status = 'up';
        } else {
          status = 'down';
        }

        resolve({
          name: target.name,
          url: `http://${hostIp}:${target.port}`,
          port: target.port,
          statusCode: code,
          status,
          latencyMs: latency,
          lastChecked: Date.now(),
          notes: target.notes,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        name: target.name,
        url: `http://${hostIp}:${target.port}`,
        port: target.port,
        statusCode: null,
        status: 'down',
        latencyMs: Date.now() - startTime,
        lastChecked: Date.now(),
        notes: 'Timeout (>3s)',
      });
    });

    req.on('error', (err) => {
      resolve({
        name: target.name,
        url: `http://${hostIp}:${target.port}`,
        port: target.port,
        statusCode: null,
        status: 'down',
        latencyMs: Date.now() - startTime,
        lastChecked: Date.now(),
        notes: err.message.slice(0, 30),
      });
    });
  });
}

export async function runServiceProbes(hostIp: string = '192.168.0.26', force: boolean = false): Promise<ServiceProbeResult[]> {
  const now = Date.now();
  // Probe cache: only run every 60s unless forced
  if (!force && cachedProbeResults.length > 0 && now - lastProbeTime < 60000) {
    return cachedProbeResults;
  }

  try {
    const promises = PROBE_TARGETS.map((target) => probeUrl(target, hostIp));
    cachedProbeResults = await Promise.all(promises);
    lastProbeTime = now;
    return cachedProbeResults;
  } catch {
    return cachedProbeResults;
  }
}
