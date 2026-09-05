import http from 'node:http';
import https from 'node:https';
import { ContainerItem, ServiceHealthReport, ServiceHealthIssue } from '../types.js';
import { logger } from '../logger.js';

/*
 * Health and recent-failure counts from the *arr APIs.
 *
 * These applications know perfectly well when they are unhappy -- they maintain
 * a curated health endpoint and a history of what failed -- but that knowledge
 * stays inside them. A container that is "running", passing its healthcheck and
 * answering on its port can be failing every indexer query it makes, and nothing
 * outside notices.
 *
 * This is preferred over scraping logs wherever an API exists, because it is
 * structured, already triaged by the application, and does not break the first
 * time someone changes a log format. Log scraping is still the only option for
 * services with no API at all.
 *
 * A caveat worth recording: `/health` alone is not enough. On the host this was
 * written for, Prowlarr's health endpoint returned `[]` while its history showed
 * 23 failed indexer queries. Health covers configuration problems; history
 * covers operational ones, and the interesting failures are usually the latter.
 */

const SCAN_INTERVAL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 6000;
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/*
 * The API version is per-application, not shared across the family. Getting this
 * wrong asks for a route that does not exist, and the resulting 404 is easy to
 * misread as "the service is broken".
 */
const API_VERSION: Record<string, 'v1' | 'v3'> = {
  radarr: 'v3',
  sonarr: 'v3',
  lidarr: 'v1',
  readarr: 'v1',
  prowlarr: 'v1',
};

/** Radarr and Sonarr both use 4 for `downloadFailed`. */
const EVENT_DOWNLOAD_FAILED = 4;

let latest: ServiceHealthReport[] = [];
let timer: NodeJS.Timeout | null = null;
let scanning = false;

export function getServiceHealth(): ServiceHealthReport[] {
  return latest;
}

function fetchJson<T>(url: string, apiKey: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      return reject(err as Error);
    }
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.get(
      url,
      { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error('Invalid JSON'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Timed out'));
    });
  });
}

interface RawHealth {
  source?: string;
  type?: string;
  message?: string;
}

/**
 * Sonarr returns `wikiUrl` as an object where Radarr returns a string, so
 * nothing here touches it. Only source/type/message are portable across the
 * family.
 */
function normaliseHealth(raw: unknown): ServiceHealthIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h: RawHealth) => ({
      source: String(h.source ?? 'unknown'),
      type: (h.type ?? '').toLowerCase() === 'error' ? ('error' as const) : ('warning' as const),
      message: String(h.message ?? '').slice(0, 300),
    }))
    .filter((h) => h.message !== '' && (h.type === 'error' || h.type === 'warning'));
}

/**
 * Failures in the last day.
 *
 * Radarr and Sonarr expose a `since` endpoint, so the window is applied by the
 * server. Prowlarr has no equivalent for the `successful=false` filter, so a
 * page of recent failures is fetched newest-first and filtered here -- counting
 * its all-time total instead would produce a number that only ever grows and
 * says nothing about now.
 */
async function countRecentFailures(
  baseUrl: string,
  version: 'v1' | 'v3',
  service: string,
  apiKey: string,
  since: Date
): Promise<number | undefined> {
  try {
    if (service === 'prowlarr') {
      const page = await fetchJson<{ records?: Array<{ date?: string }> }>(
        `${baseUrl}/api/v1/history?successful=false&pageSize=50&sortKey=date&sortDirection=descending`,
        apiKey
      );
      const records = page.records ?? [];
      return records.filter((r) => {
        const t = r.date ? Date.parse(r.date) : NaN;
        return Number.isFinite(t) && t >= since.getTime();
      }).length;
    }

    const rows = await fetchJson<unknown>(
      `${baseUrl}/api/${version}/history/since?date=${since.toISOString()}&eventType=${EVENT_DOWNLOAD_FAILED}`,
      apiKey
    );
    return Array.isArray(rows) ? rows.length : undefined;
  } catch {
    // Advisory: a missing history must not cost us the health result.
    return undefined;
  }
}

export async function runServiceHealthScan(
  containers: ContainerItem[]
): Promise<ServiceHealthReport[]> {
  if (scanning) return latest;
  scanning = true;

  try {
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const reports: ServiceHealthReport[] = [];

    const targets = containers.filter((c) => {
      if (c.state !== 'running' || c.hidden) return false;
      const key = (c.integration || c.name).toLowerCase();
      return Object.keys(API_VERSION).some((s) => key.includes(s));
    });

    await Promise.all(
      targets.map(async (c) => {
        const key = (c.integration || c.name).toLowerCase();
        const service = Object.keys(API_VERSION).find((s) => key.includes(s));
        if (!service) return;

        const apiKey = c.integrationConfig?.apiKey;
        // Without a key there is nothing to ask; stay silent rather than
        // reporting a service as broken because it is merely unconfigured.
        if (!apiKey) return;

        const configured = c.integrationConfig?.url;
        const published = (c.ports || []).find((p) => p.publicPort)?.publicPort;
        const baseUrl = configured
          ? configured.replace(/\/$/, '')
          : published
            ? `http://127.0.0.1:${published}`
            : null;
        if (!baseUrl) return;

        const version = API_VERSION[service];

        try {
          const rawHealth = await fetchJson<unknown>(`${baseUrl}/api/${version}/health`, apiKey);
          const issues = normaliseHealth(rawHealth);
          const recentFailures = await countRecentFailures(
            baseUrl,
            version,
            service,
            apiKey,
            since
          );

          reports.push({
            name: c.displayName || c.name,
            service,
            issues,
            recentFailures,
            failureWindowHours: FAILURE_WINDOW_MS / 3_600_000,
            checkedAt: Date.now(),
          });
        } catch (err) {
          reports.push({
            name: c.displayName || c.name,
            service,
            issues: [],
            unreachable: (err as Error).message.slice(0, 120),
            failureWindowHours: FAILURE_WINDOW_MS / 3_600_000,
            checkedAt: Date.now(),
          });
        }
      })
    );

    latest = reports.sort((a, b) => a.name.localeCompare(b.name));
    return latest;
  } catch (err) {
    logger.warn('servicehealth', 'Scan failed', { message: (err as Error).message });
    return latest;
  } finally {
    scanning = false;
  }
}

/** Own timer, for the same reason the reclaim scan has one. */
export function startServiceHealthScanner(getContainers: () => ContainerItem[]): void {
  if (timer) return;

  const tick = () => {
    const containers = getContainers();
    if (containers.length === 0) return;
    runServiceHealthScan(containers).catch(() => {
      // Already logged.
    });
  };

  setTimeout(tick, 30_000).unref();
  timer = setInterval(tick, SCAN_INTERVAL_MS);
  timer.unref();
}

export function stopServiceHealthScanner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
