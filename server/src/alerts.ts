import http from 'node:http';
import https from 'node:https';
import { Problem, Severity, DashboardSettings } from './types.js';
import { logger } from './logger.js';

/*
 * Outbound alerting.
 *
 * Guardian is a glance dashboard, and every check in it only pays off if you are
 * glancing. Every incident this was built after shared one property: the
 * dashboard knew, and nobody was looking. One webhook fired on transitions
 * converts the whole thing from decoration into defence.
 *
 * Deliberately small. A queue, retry policy and templating engine would be more
 * impressive and much more likely to be the thing that is broken when it finally
 * matters. What this guarantees instead:
 *
 *  - It fires on *transitions*, never on state. A problem that is still true ten
 *    minutes later is not a new alert.
 *  - It cannot flood. Each problem id has a cooldown, and a single burst is
 *    coalesced into one request.
 *  - It cannot take the sampler down. Every failure path is swallowed and
 *    logged; the loop never awaits delivery.
 *  - It says nothing at all on the first sample after boot, because otherwise
 *    every restart would page you with the pre-existing state of the world.
 */

/** Re-notify about a problem that never cleared only this often. */
const DEFAULT_COOLDOWN_MINUTES = 60;
const REQUEST_TIMEOUT_MS = 5000;
/** A pathological state (say, every container unhealthy) must not post a novel. */
const MAX_ITEMS_PER_PAYLOAD = 12;

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, ok: 2 };

interface TrackedProblem {
  problem: Problem;
  /** When we last told anyone about it. */
  lastNotifiedAt: number;
}

export interface AlertEvent {
  kind: 'raised' | 'resolved';
  problem: Problem;
}

let active = new Map<string, TrackedProblem>();
let primed = false;

/** Test seam, and how the server resets state if settings change materially. */
export function resetAlertState(): void {
  active = new Map();
  primed = false;
}

function meetsThreshold(severity: Severity, minimum: Severity): boolean {
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[minimum];
}

/**
 * Diffs the current problem list against the last one and returns what changed.
 *
 * Exported separately from delivery so the decision logic can be tested without
 * a socket, and so a delivery failure cannot corrupt the state machine.
 */
export function diffProblems(
  problems: Problem[],
  now: number,
  minSeverity: Severity,
  cooldownMs: number
): AlertEvent[] {
  const events: AlertEvent[] = [];
  const seen = new Set<string>();

  for (const problem of problems) {
    seen.add(problem.id);
    const existing = active.get(problem.id);

    if (!existing) {
      if (meetsThreshold(problem.severity, minSeverity)) {
        events.push({ kind: 'raised', problem });
      }
      active.set(problem.id, { problem, lastNotifiedAt: now });
      continue;
    }

    /*
     * An escalation is news even though the id is unchanged: a disk that was
     * warning and is now critical must not wait out the cooldown.
     */
    const escalated = SEVERITY_RANK[problem.severity] < SEVERITY_RANK[existing.problem.severity];
    const stale = now - existing.lastNotifiedAt >= cooldownMs;

    if ((escalated || stale) && meetsThreshold(problem.severity, minSeverity)) {
      events.push({ kind: 'raised', problem });
      existing.lastNotifiedAt = now;
    }
    existing.problem = problem;
  }

  for (const [id, tracked] of active) {
    if (seen.has(id)) continue;
    if (meetsThreshold(tracked.problem.severity, minSeverity)) {
      events.push({ kind: 'resolved', problem: tracked.problem });
    }
    active.delete(id);
  }

  return events;
}

/**
 * Posts one JSON body describing a batch of events.
 *
 * The payload carries the same message under several keys on purpose. Discord
 * reads `content`, Slack and its many imitators read `text`, ntfy reads
 * `message` — sending all three means the common targets work with no
 * templating and no per-service adapter.
 */
function postWebhook(url: string, payload: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      logger.warn('alerts', 'Webhook URL is not valid, skipping', { url: url.slice(0, 80) });
      return resolve(false);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      logger.warn('alerts', 'Webhook URL must be http or https', { protocol: parsed.protocol });
      return resolve(false);
    }

    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'User-Agent': 'Guardian-Alerts/1.0',
        },
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        if (code < 200 || code >= 300) {
          logger.warn('alerts', `Webhook returned HTTP ${code}`);
          return resolve(false);
        }
        resolve(true);
      }
    );

    req.on('error', (err) => {
      logger.warn('alerts', 'Webhook delivery failed', { message: err.message });
      resolve(false);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      logger.warn('alerts', 'Webhook timed out');
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

function summarise(events: AlertEvent[], hostname: string): Record<string, unknown> {
  const raised = events.filter((e) => e.kind === 'raised');
  const resolved = events.filter((e) => e.kind === 'resolved');
  const worst = raised.reduce<Severity>(
    (w, e) => (SEVERITY_RANK[e.problem.severity] < SEVERITY_RANK[w] ? e.problem.severity : w),
    'ok'
  );

  const lines: string[] = [];
  for (const e of raised.slice(0, MAX_ITEMS_PER_PAYLOAD)) {
    lines.push(`${e.problem.severity === 'crit' ? '[CRIT]' : '[WARN]'} ${e.problem.label} — ${e.problem.detail}`);
  }
  for (const e of resolved.slice(0, MAX_ITEMS_PER_PAYLOAD)) {
    lines.push(`[OK] Resolved: ${e.problem.label}`);
  }
  const hidden = Math.max(0, events.length - lines.length);
  if (hidden > 0) lines.push(`…and ${hidden} more.`);

  const title =
    raised.length > 0
      ? `${hostname}: ${raised.length} new issue${raised.length === 1 ? '' : 's'}`
      : `${hostname}: ${resolved.length} issue${resolved.length === 1 ? '' : 's'} resolved`;

  const message = `${title}\n${lines.join('\n')}`;

  return {
    title,
    // Aliases so Discord / Slack / ntfy all render this without an adapter.
    message,
    text: message,
    content: message,
    severity: raised.length > 0 ? worst : 'ok',
    hostname,
    timestamp: Date.now(),
    raised: raised.map((e) => e.problem),
    resolved: resolved.map((e) => e.problem),
  };
}

/**
 * Entry point from the sampling loop.
 *
 * Never throws and never blocks: the caller is not expected to await it.
 */
export async function processProblems(
  problems: Problem[],
  settings: DashboardSettings,
  hostname: string
): Promise<void> {
  try {
    const url = settings.alertWebhookUrl?.trim();
    const minSeverity: Severity = settings.alertMinSeverity === 'crit' ? 'crit' : 'warn';
    const cooldownMs =
      Math.max(1, settings.alertCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60_000;

    const events = diffProblems(problems, Date.now(), minSeverity, cooldownMs);

    /*
     * The first pass after boot only establishes the baseline. Without this,
     * restarting Guardian on a host with three long-standing warnings would
     * immediately notify about all three as though they had just happened.
     */
    if (!primed) {
      primed = true;
      return;
    }

    if (!url || events.length === 0) return;

    const delivered = await postWebhook(url, summarise(events, hostname));
    if (delivered) {
      logger.info('alerts', `Dispatched ${events.length} alert event(s)`);
    } else {
      /*
       * The events are not re-queued. A monitoring tool that silently retries
       * has to decide how long to keep a stale alert alive, and a late "disk
       * nearly full" for a disk that has since been cleared is worse than a
       * missed one. The failure is in the log, and the problem is still on the
       * dashboard.
       */
      logger.warn('alerts', `Dropped ${events.length} alert event(s) after failed delivery`);
    }
  } catch (err) {
    // Alerting must never be able to break the sampler.
    logger.error('alerts', 'Alert processing failed', err);
  }
}
