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
  /** Sent as `X-Api-Key`, so an authenticated service reports health instead of 401. */
  apiKey?: string;
}

const PROBE_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;
const MAX_TARGETS = 40;

/*
 * Endpoints that answer more usefully than "/" on these well-known services.
 *
 * The *arr API version is per-application, not shared: Radarr, Sonarr, Lidarr and
 * Readarr are all v3, while Prowlarr is still v1. Probing Radarr at `/api/v1/...`
 * asks for a route that does not exist, so a perfectly healthy instance is
 * reported by whatever its 404 handler decides to do.
 */
const HEALTH_PATHS: Record<string, string> = {
  prowlarr: '/api/v1/health',
  sonarr: '/api/v3/health',
  radarr: '/api/v3/health',
  lidarr: '/api/v1/health',
  readarr: '/api/v1/health',
  bazarr: '/api/system/status',
  jellyfin: '/health',
  emby: '/health',
  go2rtc: '/api',
};

/*
 * Default listen ports for services that commonly run inside another
 * container's network namespace (`network_mode: container:gluetun`) or in host mode.
 *
 * Such a container publishes nothing of its own -- the *parent* publishes on its
 * behalf -- so port-to-container attribution has to be inferred. Without this,
 * Prowlarr behind Gluetun is probed and labelled as "Gluetun", and Prowlarr
 * itself is never probed at all.
 */
const DEFAULT_SERVICE_PORTS: Record<string, number> = {
  prowlarr: 9696,
  radarr: 7878,
  sonarr: 8989,
  lidarr: 8686,
  readarr: 8787,
  bazarr: 6767,
  qbittorrent: 8080,
  transmission: 9091,
  sabnzbd: 8080,
  deluge: 8112,
  go2rtc: 1984,
  'qubo-dashboard': 3002,
  qubo: 3002,
  adguardhome: 3080,
  adguard: 3080,
  streamystats: 3003,
  jellyfin: 8096,
  seerr: 5055,
  overseerr: 5055,
};

/** Ports dedicated to non-HTTP protocols that fail or timeout when probed via HTTP GET. */
const NON_HTTP_PORTS = new Set([
  22,    // SSH
  53,    // DNS
  67,    // DHCP
  68,    // DHCP
  123,   // NTP
  554,   // RTSP
  853,   // DNS-over-TLS
  1883,  // MQTT
  5432,  // PostgreSQL
  5443,  // DNSCrypt
  8554,  // RTSP
  8555,  // WebRTC raw
  8883,  // MQTT TLS
  51820, // WireGuard
  51826, // Apple HomeKit HAP
]);

function defaultPortFor(name: string): number | null {
  const key = name.toLowerCase();
  for (const [service, port] of Object.entries(DEFAULT_SERVICE_PORTS)) {
    if (key.includes(service)) return port;
  }
  return null;
}

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
 * Containers contribute their published ports and custom URLs; bookmarks contribute
 * anything else the operator cares about, which covers host services that are not
 * containers at all. Hidden containers are skipped — if it is not on the
 * dashboard, it should not be probed.
 */
export function buildProbeTargets(
  containers: ContainerItem[] = [],
  bookmarks: CustomAppBookmark[] = []
): ProbeTarget[] {
  const byPort = new Map<number, ProbeTarget>();
  const running = containers.filter((c) => !c.hidden && c.state === 'running');

  const targetFor = (c: ContainerItem, port: number, notes?: string): ProbeTarget => ({
    name: c.displayName || c.name,
    port,
    path: healthPathFor(c.name),
    notes: notes ?? c.composeProject,
    // The API key the operator already supplied for the in-card widget. Reusing
    // it turns a permanent "unauthorized" row into a real health check.
    apiKey: c.integrationConfig?.apiKey,
  });

  // 1. Explicit custom URLs take precedence (e.g. AdGuard customUrl: http://192.168.0.26:3080)
  const containersWithCustomUrl = new Set<string>();
  for (const c of running) {
    if (c.customUrl) {
      const port = portFromBookmarkUrl(c.customUrl);
      if (port && !NON_HTTP_PORTS.has(port) && !byPort.has(port)) {
        byPort.set(port, targetFor(c, port, 'custom URL'));
        containersWithCustomUrl.add(c.name);
      }
    }
  }

  // 2. Namespace guests first, so they win the port they actually own.
  for (const c of running) {
    if (!c.networkParent || (c.ports || []).length > 0) continue;

    const parent = running.find((p) => p.name === c.networkParent);
    if (!parent) continue;

    const wanted = defaultPortFor(c.name);
    if (!wanted) continue;

    const published = (parent.ports || []).find((p) => p.privatePort === wanted && p.publicPort);
    if (!published?.publicPort || NON_HTTP_PORTS.has(published.publicPort) || byPort.has(published.publicPort)) continue;

    byPort.set(published.publicPort, targetFor(c, published.publicPort, `via ${parent.name}`));
  }

  // 3. Published container ports
  for (const c of running) {
    if (containersWithCustomUrl.has(c.name)) continue;
    for (const p of c.ports || []) {
      const port = p.publicPort;
      // Only published HTTP ports are reachable from where Guardian runs.
      if (!port || NON_HTTP_PORTS.has(port) || byPort.has(port)) continue;

      byPort.set(port, targetFor(c, port));
    }
  }

  // 4. Host-networked containers with known default service ports if not yet covered
  for (const c of running) {
    if (c.networkMode === 'host' && (c.ports || []).length === 0) {
      const wanted = defaultPortFor(c.name);
      if (wanted && !NON_HTTP_PORTS.has(wanted) && !byPort.has(wanted)) {
        byPort.set(wanted, targetFor(c, wanted, 'host network'));
      }
    }
  }

  // 5. Bookmarks
  for (const b of bookmarks) {
    const port = portFromBookmarkUrl(b.url || '');
    if (!port || NON_HTTP_PORTS.has(port) || byPort.has(port)) continue;
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

    const headers: Record<string, string> = { 'User-Agent': 'Guardian-Prober/1.0' };
    if (target.apiKey) headers['X-Api-Key'] = target.apiKey;

    const req = http.get(url, { timeout: PROBE_TIMEOUT_MS, headers }, (res) => {
      res.resume(); // Drain so the socket can be released.

      const code = res.statusCode || null;

      /*
       * "Down" must mean the service did not answer.
       *
       * Any HTTP status at all proves something is listening and serving. A
       * reverse proxy with no route for `/` answers 404, and reporting that as
       * "down" put two permanently-red rows in the endpoint table for a Traefik
       * that was working perfectly -- which is exactly how an operator learns to
       * stop reading the table. Only a 5xx (the service answered, and answered
       * that it is broken) or a transport failure is a genuine outage.
       */
      let status: ServiceProbeResult['status'] = 'up';
      let notes: string | undefined;

      if (code === 401 || code === 403) status = 'unauthorized';
      else if (code && code >= 300 && code < 400) status = 'redirect';
      else if (code && code >= 500) {
        status = 'down';
        notes = `server error ${code}`;
      } else if (code && code >= 400) {
        status = 'up';
        notes = `reachable, no route at ${target.path}`;
      }

      finish(code, status, notes);
    });

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
