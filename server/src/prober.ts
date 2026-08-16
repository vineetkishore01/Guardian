import http from 'node:http';
import { ServiceProbeResult, ContainerItem, CustomAppBookmark } from './types.js';

/*
 * HTTP health prober.
 *
 * Targets used to be a hardcoded array of nine ports baked into this file, which
 * meant a newly-added container was never probed and a removed one was probed
 * forever. They are now derived from what actually exists: every container's
 * published port, plus any port a bookmark points at (which is how host-level
 * services outside Docker get covered).
 */

export interface ProbeTarget {
  name: string;
  port: number;
  path: string;
  notes?: string;
}

const PROBE_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;
const MAX_TARGETS = 40;

/** Endpoints that answer more usefully than "/" on these well-known services. */
const HEALTH_PATHS: Record<string, string> = {
  prowlarr: '/api/v1/health',
  sonarr: '/api/v1/health',
  radarr: '/api/v1/health',
  lidarr: '/api/v1/health',
  readarr: '/api/v1/health',
  bazarr: '/api/system/status',
  jellyfin: '/health',
  emby: '/health',
};

function healthPathFor(name: string): string {
  const key = name.toLowerCase();
  for (const [service, probePath] of Object.entries(HEALTH_PATHS)) {
    if (key.includes(service)) return probePath;
  }
  return '/';
}

/** Pulls a port out of a bookmark URL, including unexpanded {host} templates. */
function portFromBookmarkUrl(raw: string): number | null {
  const match = raw.match(/:(\d{2,5})(?:\/|$|\?)/);
  if (!match) return null;
  const port = parseInt(match[1], 10);
  return port > 0 && port <= 65535 ? port : null;
}

/**
 * Builds the probe list from live state.
 *
 * Containers contribute their published ports; bookmarks contribute anything
 * else the operator cares about, which covers host services that are not
 * containers at all. Hidden containers are skipped — if it is not on the
 * dashboard, it should not be probed.
 */
export function buildProbeTargets(
  containers: ContainerItem[] = [],
  bookmarks: CustomAppBookmark[] = []
): ProbeTarget[] {
  const byPort = new Map<number, ProbeTarget>();

  for (const c of containers) {
    if (c.hidden || c.state !== 'running') continue;

    for (const p of c.ports || []) {
      const port = p.publicPort;
      // Only published ports are reachable from where Guardian runs.
      if (!port || byPort.has(port)) continue;

      byPort.set(port, {
        name: c.displayName || c.name,
        port,
        path: healthPathFor(c.name),
        notes: c.composeProject,
      });
    }
  }

  for (const b of bookmarks) {
    const port = portFromBookmarkUrl(b.url || '');
    if (!port || byPort.has(port)) continue;
    byPort.set(port, { name: b.name, port, path: '/', notes: 'bookmark' });
  }

  return [...byPort.values()]
    .sort((a, b) => a.port - b.port)
    .slice(0, MAX_TARGETS);
}

function probeUrl(target: ProbeTarget, hostIp: string): Promise<ServiceProbeResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const url = `http://${hostIp}:${target.port}${target.path}`;

    const finish = (
      statusCode: number | null,
      status: ServiceProbeResult['status'],
      notes?: string
    ) =>
      resolve({
        name: target.name,
        url: `http://${hostIp}:${target.port}`,
        port: target.port,
        statusCode,
        status,
        latencyMs: Date.now() - startTime,
        lastChecked: Date.now(),
        notes: notes ?? target.notes,
      });

    const req = http.get(
      url,
      { timeout: PROBE_TIMEOUT_MS, headers: { 'User-Agent': 'Guardian-Prober/1.0' } },
      (res) => {
        res.resume(); // Drain so the socket can be released.

        const code = res.statusCode || null;
        let status: ServiceProbeResult['status'] = 'up';
        if (code === 401 || code === 403) status = 'unauthorized';
        else if (code && code >= 300 && code < 400) status = 'redirect';
        else if (code && code >= 200 && code < 400) status = 'up';
        else status = 'down';

        finish(code, status);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      finish(null, 'down', `no response in ${PROBE_TIMEOUT_MS / 1000}s`);
    });

    req.on('error', (err) => finish(null, 'down', err.message.slice(0, 40)));
  });
}

let cachedProbeResults: ServiceProbeResult[] = [];
let lastProbeTime = 0;
let lastTargetKey = '';

export async function runServiceProbes(
  hostIp: string = '',
  targets: ProbeTarget[] = [],
  force: boolean = false
): Promise<ServiceProbeResult[]> {
  const now = Date.now();
  const target = hostIp && hostIp.trim() ? hostIp.trim() : '127.0.0.1';

  // Re-probe immediately when the target set changes — a container that just
  // started should not wait out the remainder of the cache window.
  const targetKey = targets.map((t) => t.port).join(',');
  const targetsChanged = targetKey !== lastTargetKey;

  if (!force && !targetsChanged && cachedProbeResults.length > 0 && now - lastProbeTime < CACHE_TTL_MS) {
    return cachedProbeResults;
  }

  if (targets.length === 0) {
    cachedProbeResults = [];
    lastTargetKey = targetKey;
    lastProbeTime = now;
    return cachedProbeResults;
  }

  try {
    cachedProbeResults = await Promise.all(targets.map((t) => probeUrl(t, target)));
    lastProbeTime = now;
    lastTargetKey = targetKey;
    return cachedProbeResults;
  } catch {
    return cachedProbeResults;
  }
}
