import https from 'node:https';
import { Problem, Severity, DashboardSettings } from './types.js';
import { logger } from './logger.js';

/*
 * Outbound alerting, to Telegram and WhatsApp.
 *
 * Guardian is a glance dashboard, and every check in it only pays off if you are
 * glancing. Every incident this was built after shared one property: the
 * dashboard knew, and nobody was looking. Firing on transitions converts the
 * whole thing from decoration into defence.
 *
 * Two channels, both optional and independent: configure either, both, or
 * neither. Neither is a no-op rather than an error -- the problems are still on
 * the dashboard, the operator simply has not asked to be told.
 *
 * Deliberately small. A queue, retry policy and templating engine would be more
 * impressive and much more likely to be the thing that is broken when it finally
 * matters. What this guarantees instead:
 *
 *  - It fires on *transitions*, never on state. A problem that is still true ten
 *    minutes later is not a new alert.
 *  - It cannot flood. Each problem id has a cooldown, and a single burst is
 *    coalesced into one message per channel.
 *  - It cannot take the sampler down. Every failure path is swallowed and
 *    logged; the loop never awaits delivery.
 *  - It says nothing at all on the first sample after boot, because otherwise
 *    every restart would page you with the pre-existing state of the world.
 *  - One channel failing never suppresses the other, which is much of the point
 *    of having two.
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

/* ------------------------------- channels ------------------------------- */

/**
 * Formats one batch of events as plain text.
 *
 * Deliberately unformatted. Telegram's MarkdownV2 requires escaping some
 * eighteen characters, and alert text is full of them -- `/mnt/nas`, `[CRIT]`,
 * `86%`, container names with dots and dashes. A missed escape returns a 400
 * and loses the alert entirely, which is a poor trade for bold text. WhatsApp
 * renders `*bold*` natively without a mode flag, so the one marker used there
 * costs nothing.
 */
function formatMessage(events: AlertEvent[], hostname: string): { title: string; body: string } {
  const raised = events.filter((e) => e.kind === 'raised');
  const resolved = events.filter((e) => e.kind === 'resolved');

  const lines: string[] = [];
  for (const e of raised.slice(0, MAX_ITEMS_PER_PAYLOAD)) {
    const tag = e.problem.severity === 'crit' ? 'CRITICAL' : 'WARNING';
    lines.push(`[${tag}] ${e.problem.label}`);
    lines.push(`  ${e.problem.detail}`);
  }
  for (const e of resolved.slice(0, MAX_ITEMS_PER_PAYLOAD)) {
    lines.push(`[OK] Resolved: ${e.problem.label}`);
  }

  const shownCount =
    Math.min(raised.length, MAX_ITEMS_PER_PAYLOAD) +
    Math.min(resolved.length, MAX_ITEMS_PER_PAYLOAD);
  const hidden = events.length - shownCount;
  if (hidden > 0) lines.push(`...and ${hidden} more.`);

  const title =
    raised.length > 0
      ? `${hostname}: ${raised.length} new issue${raised.length === 1 ? '' : 's'}`
      : `${hostname}: ${resolved.length} issue${resolved.length === 1 ? '' : 's'} resolved`;

  return { title, body: lines.join('\n') };
}

/** Bounded so neither transport rejects the request outright. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/*
 * Telegram caps a message at 4096 UTF-8 characters and answers 429 with a
 * `parameters.retry_after` when a bot is sending too fast. Nothing here retries
 * -- see the note in processProblems -- but the value is logged, because "the
 * bot is rate limited for another 40 seconds" is otherwise a very confusing
 * silent failure.
 */
const TELEGRAM_MAX_CHARS = 4096;

interface TelegramResponse {
  ok?: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: clamp(text, TELEGRAM_MAX_CHARS),
      // No parse_mode on purpose: see formatMessage.
      disable_web_page_preview: true,
    });
    const body = Buffer.from(payload, 'utf-8');

    /*
     * The token goes into the path *raw*.
     *
     * A bot token is `<digits>:<alphanumerics>` and that colon is structural --
     * percent-encoding it to %3A yields `bot123%3AAA.../sendMessage`, which
     * Telegram answers with 404 for every single alert. encodeURIComponent is
     * therefore wrong here. Instead the token is restricted to the characters a
     * real token can contain, which keeps a mistyped value from breaking out of
     * the path segment.
     */
    const safeToken = token.replace(/[^A-Za-z0-9:_-]/g, '');

    const req = https.request(
      `https://api.telegram.org/bot${safeToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'User-Agent': 'Guardian-Alerts/1.0',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed: TelegramResponse = {};
          try {
            parsed = JSON.parse(raw) as TelegramResponse;
          } catch {
            // Fall through to the status-code check below.
          }

          if (parsed.ok === true) return resolve(true);

          /*
           * Telegram reports application errors in the body with HTTP 200 in
           * some proxy setups, so `ok` is the authoritative field rather than
           * the status code. Its `description` is genuinely useful -- "chat not
           * found", "bot was blocked by the user" -- so it is surfaced verbatim.
           */
          logger.warn('alerts', 'Telegram rejected the message', {
            status: res.statusCode,
            description: parsed.description?.slice(0, 160),
            retryAfterSec: parsed.parameters?.retry_after,
          });
          resolve(false);
        });
      }
    );

    req.on('error', (err) => {
      logger.warn('alerts', 'Telegram delivery failed', { message: err.message });
      resolve(false);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      logger.warn('alerts', 'Telegram timed out');
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

/*
 * CallMeBot is an unofficial free service and the whole message travels in the
 * query string, so this is kept much shorter than Telegram's limit to keep the
 * URL within what intermediaries will accept.
 */
const WHATSAPP_MAX_CHARS = 700;

function sendWhatsApp(phone: string, apiKey: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    /*
     * The documented format includes the country code and CallMeBot's examples
     * show a leading `+`. Everything except digits and that `+` is stripped,
     * because operators reasonably type "+44 7700 900123" and the spaces would
     * otherwise be encoded into the number itself.
     */
    const cleanPhone = phone.trim().replace(/[^\d+]/g, '');

    const url =
      `https://api.callmebot.com/whatsapp.php` +
      `?phone=${encodeURIComponent(cleanPhone)}` +
      `&text=${encodeURIComponent(clamp(text, WHATSAPP_MAX_CHARS))}` +
      `&apikey=${encodeURIComponent(apiKey.trim())}`;

    const req = https.get(url, { headers: { 'User-Agent': 'Guardian-Alerts/1.0' } }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        const code = res.statusCode ?? 0;
        if (code >= 200 && code < 300) return resolve(true);

        /*
         * CallMeBot answers in HTML rather than JSON, and its failure messages
         * ("APIKey is invalid", "You need to activate the API") are the only
         * diagnostic available, so a snippet of the body is logged with the
         * tags stripped.
         */
        logger.warn('alerts', 'CallMeBot rejected the message', {
          status: code,
          body: raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
        });
        resolve(false);
      });
    });

    req.on('error', (err) => {
      logger.warn('alerts', 'WhatsApp delivery failed', { message: err.message });
      resolve(false);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      logger.warn('alerts', 'WhatsApp timed out');
      resolve(false);
    });
  });
}

/** Which channels are configured well enough to attempt. */
export function configuredChannels(settings: DashboardSettings): string[] {
  const channels: string[] = [];
  if (settings.alertTelegramBotToken?.trim() && settings.alertTelegramChatId?.trim()) {
    channels.push('telegram');
  }
  if (settings.alertWhatsappPhone?.trim() && settings.alertWhatsappApiKey?.trim()) {
    channels.push('whatsapp');
  }
  return channels;
}

/**
 * Sends one batch to every configured channel.
 *
 * Both halves of a channel's credentials are required before it is attempted:
 * a bot token with no chat id cannot address anyone, and firing a request that
 * is certain to fail only produces log noise that looks like a real outage.
 *
 * Channels are independent. One failing must not suppress the other, which is
 * much of the point of having two.
 */
async function dispatch(
  events: AlertEvent[],
  settings: DashboardSettings,
  hostname: string
): Promise<{ sent: string[]; failed: string[] }> {
  const { title, body } = formatMessage(events, hostname);
  const text = `${title}\n\n${body}`;

  const attempts: Array<Promise<{ channel: string; ok: boolean }>> = [];

  if (settings.alertTelegramBotToken?.trim() && settings.alertTelegramChatId?.trim()) {
    attempts.push(
      sendTelegram(
        settings.alertTelegramBotToken.trim(),
        settings.alertTelegramChatId.trim(),
        text
      ).then((ok) => ({ channel: 'telegram', ok }))
    );
  }

  if (settings.alertWhatsappPhone?.trim() && settings.alertWhatsappApiKey?.trim()) {
    // WhatsApp renders *bold* natively, so the title gets emphasis for free.
    const whatsappText = `*${title}*\n\n${body}`;
    attempts.push(
      sendWhatsApp(
        settings.alertWhatsappPhone,
        settings.alertWhatsappApiKey,
        whatsappText
      ).then((ok) => ({ channel: 'whatsapp', ok }))
    );
  }

  const results = await Promise.all(attempts);
  return {
    sent: results.filter((r) => r.ok).map((r) => r.channel),
    failed: results.filter((r) => !r.ok).map((r) => r.channel),
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

    if (events.length === 0) return;

    // No channel configured is a no-op, not an error. The problems are still on
    // the dashboard; the operator simply has not asked to be told about them.
    if (configuredChannels(settings).length === 0) return;

    const { sent, failed } = await dispatch(events, settings, hostname);

    if (sent.length > 0) {
      logger.info('alerts', `Sent ${events.length} alert event(s) via ${sent.join(', ')}`);
    }
    if (failed.length > 0) {
      /*
       * Not re-queued. A monitoring tool that silently retries has to decide
       * how long to keep a stale alert alive, and a late "disk nearly full" for
       * a disk that has since been cleared is worse than a missed one. The
       * failure is in the log, and the problem is still on the dashboard.
       */
      logger.warn('alerts', `Failed to deliver via ${failed.join(', ')}`);
    }
  } catch (err) {
    // Alerting must never be able to break the sampler.
    logger.error('alerts', 'Alert processing failed', err);
  }
}
