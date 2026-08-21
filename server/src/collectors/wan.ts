import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { WanTelemetry } from '../types.js';
import { logger } from '../logger.js';

let cachedWan: WanTelemetry | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 600_000; // 10 minutes

function httpsGet(url: string, timeoutMs: number = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Guardian/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP error ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Measures TCP round-trip latency to a fast public DNS (1.1.1.1 or 8.8.8.8).
 */
function measurePingMs(host: string = '1.1.1.1', port: number = 53): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        socket.destroy();
      }
    };

    socket.setTimeout(2000, () => {
      cleanup();
      resolve(999);
    });

    socket.connect(port, host, () => {
      const ping = Date.now() - start;
      cleanup();
      resolve(ping);
    });

    socket.on('error', () => {
      cleanup();
      resolve(999);
    });
  });
}

/**
 * Collects public WAN IP and ISP info.
 */
export async function collectWanTelemetry(forceRefresh: boolean = false): Promise<WanTelemetry> {
  const now = Date.now();
  if (!forceRefresh && cachedWan && now - lastFetchTime < CACHE_TTL_MS) {
    // Quick update ping latency in background
    measurePingMs('1.1.1.1', 53).then((ping) => {
      if (cachedWan && ping < 999) {
        cachedWan.pingMs = ping;
      }
    }).catch(() => {});
    return cachedWan;
  }

  try {
    // Primary source: ipapi.co or ip-api.com
    let ipData: any = {};
    try {
      const raw = await httpsGet('https://ipapi.co/json/', 3500);
      ipData = JSON.parse(raw);
    } catch {
      // Fallback: Cloudflare trace
      try {
        const trace = await httpsGet('https://1.1.1.1/cdn-cgi/trace', 2500);
        const lines = trace.split('\n');
        for (const line of lines) {
          const [k, v] = line.split('=');
          if (k === 'ip') ipData.ip = v;
          if (k === 'loc') ipData.country_code = v;
        }
      } catch {}
    }

    const pingMs = await measurePingMs('1.1.1.1', 53);

    cachedWan = {
      publicIp: ipData.ip || ipData.query || undefined,
      isp: ipData.org || ipData.isp || undefined,
      city: ipData.city || undefined,
      country: ipData.country_name || ipData.country || undefined,
      countryCode: ipData.country_code || undefined,
      pingMs: pingMs < 999 ? pingMs : undefined,
      lastChecked: now,
    };

    lastFetchTime = now;
    return cachedWan;
  } catch (err) {
    logger.warn('wan', 'Failed to fetch WAN telemetry', err);
    return cachedWan || { pingMs: undefined, lastChecked: now };
  }
}
