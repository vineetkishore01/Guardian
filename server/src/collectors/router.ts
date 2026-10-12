import http from 'node:http';
import { RouterTelemetry, RouterTelemetryPayload } from '../types.js';
import { logger } from '../logger.js';

/**
 * Router telemetry comes from the `router-telemetry` daemon running on the
 * OpenWrt box (see router-telemetry/ in this repo). The daemon serves a
 * pre-built snapshot, so a fetch is one small HTTP GET.
 *
 * Override with ROUTER_TELEMETRY_URL; set it to "off" to disable polling.
 */
const ROUTER_URL = process.env.ROUTER_TELEMETRY_URL || 'http://192.168.0.1:9191/api/telemetry';
const EXPLICITLY_CONFIGURED = Boolean(process.env.ROUTER_TELEMETRY_URL);
const TIMEOUT_MS = 2500;
/** Last good payload older than this is reported offline rather than stale. */
const STALE_LIMIT_MS = 5 * 60_000;

let lastGood: RouterTelemetryPayload | null = null;
let lastGoodAt: number | null = null;
let lastState: RouterTelemetry = {
  status: 'offline',
  endpoint: ROUTER_URL,
  fetchedAt: null,
  data: null,
};
let loggedFailure = false;

function fetchJson(url: string, timeoutMs: number): Promise<RouterTelemetryPayload> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          const parsed = JSON.parse(body) as RouterTelemetryPayload;
          if (!parsed || typeof parsed !== 'object' || !parsed.system || !parsed.multi_wan) {
            reject(new Error('Malformed router telemetry payload'));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });
  });
}

export async function collectRouterTelemetry(): Promise<RouterTelemetry> {
  if (ROUTER_URL === 'off') {
    lastState = { status: 'offline', endpoint: ROUTER_URL, fetchedAt: null, error: 'disabled', data: null };
    return lastState;
  }

  try {
    const data = await fetchJson(ROUTER_URL, TIMEOUT_MS);
    lastGood = data;
    lastGoodAt = Date.now();
    if (loggedFailure) {
      logger.info('telemetry', 'Router telemetry reachable again', { endpoint: ROUTER_URL });
      loggedFailure = false;
    }
    lastState = { status: 'live', endpoint: ROUTER_URL, fetchedAt: lastGoodAt, data };
  } catch (err) {
    const message = (err as Error).message;
    // Log the transition only; a router that is down would otherwise flood the log.
    if (!loggedFailure && (lastGood || EXPLICITLY_CONFIGURED)) {
      logger.warn('telemetry', 'Router telemetry unreachable', { endpoint: ROUTER_URL, message });
      loggedFailure = true;
    }
    const fresh = lastGoodAt !== null && Date.now() - lastGoodAt < STALE_LIMIT_MS;
    lastState = {
      status: fresh ? 'stale' : 'offline',
      endpoint: ROUTER_URL,
      fetchedAt: lastGoodAt,
      error: message,
      data: fresh ? lastGood : null,
    };
  }
  return lastState;
}

/** Latest known state, without triggering a fetch. */
export function getRouterTelemetry(): RouterTelemetry {
  return lastState;
}

/**
 * Whether the dashboard should show router telemetry at all. Hosts with no
 * router daemon stay quiet unless the user pointed Guardian at one.
 */
export function isRouterRelevant(): boolean {
  return ROUTER_URL !== 'off' && (EXPLICITLY_CONFIGURED || lastGoodAt !== null);
}
