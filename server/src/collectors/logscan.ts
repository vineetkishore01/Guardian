import { ContainerItem, ContainerLogSignal } from '../types.js';
import { fetchContainerLogs } from './docker.js';
import { logger } from '../logger.js';

/*
 * Error rate from container logs.
 *
 * The gap this closes: a container can be "running", pass its healthcheck and
 * answer on its port while its log scrolls the same failure every few seconds.
 * Nothing else in Guardian looks at log *content* -- logs are fetched only when
 * a human opens the modal -- so this class of failure was invisible by
 * construction. Several real ones were: a scraping proxy running with its
 * session cache permanently unavailable, a cleanup service failing the same
 * HTTPS call for days, a bot that could not reach its API at all.
 *
 * Used only where there is no API to ask instead. Structured endpoints are
 * better in every way and are handled by servicehealth.ts; this is the fallback
 * for the many services that expose nothing.
 *
 * Two deliberate limits on what counts as evidence:
 *
 *  - Writing to stderr is not an error. Plenty of well-behaved programs log
 *    everything there, so a stderr rate alone would permanently indict them.
 *    It is recorded as context and never on its own escalated.
 *  - Only reasonably unambiguous markers are matched. A broad pattern would
 *    catch every "0 errors" summary line and every path containing the word,
 *    and a check that cries wolf is worse than no check.
 */

const SCAN_INTERVAL_MS = 90_000;
/** How many containers are read at once, to avoid a burst of socket traffic. */
const CONCURRENCY = 4;
const MAX_LINES = 400;

/*
 * Anchored on line starts or word boundaries and paired with a following
 * context character, so "error:" and "ERROR " match while "0 errors" and
 * "/var/lib/errors" do not.
 */
const ERROR_PATTERN =
  /(^|\s)(error[:\s]|fatal[:\s]|panic[:\s]|exception[:\s]|traceback\b|critical[:\s]|\[error\]|\[fatal\]|failed to\s|unable to\s|attempts failed|failure in\s|connection refused|connection reset|timed out\b|no such host)/i;

/** Lines that look like an error but are routine reporting. */
const BENIGN_PATTERN = /\b(0 errors?|no errors?|errors?:\s*0|error_count=0)\b/i;

/*
 * An explicit severity marker beats keyword matching.
 *
 * Informational lines routinely *discuss* errors -- a VPN client explaining
 * that "i/o timeout errors indicate the connection is not working" is advice,
 * not a fault, and matching it made a perfectly healthy container look sick.
 * So a line carrying an INFO-class level is trusted and skipped, unless it also
 * carries an error-class level.
 *
 * Warning levels are deliberately *not* skipped: the most useful real signal
 * found while writing this was a service logging "[WRN] Failed to refresh app
 * status" every few seconds for days.
 */
const ERROR_LEVEL = /(^|[\s[(])(err(or)?|fatal|crit(ical)?|panic|wrn|warn(ing)?)([\s\]):]|$)/i;
const INFO_LEVEL = /(^|[\s[(])(info|debug|trace|notice|dbg|inf)([\s\]):]|$)/i;

/*
 * Whichever level marker appears first is the line's real level.
 *
 * Position matters because prose mentions severity words too. The line
 * "INFO [vpn] ... without giving any error message" contains both markers, and
 * testing only for presence classified it as an error -- the word "error"
 * appeared, just a hundred characters into an explanatory sentence. The level
 * is the one at the front.
 */
function firstMatchIndex(pattern: RegExp, text: string): number {
  const m = pattern.exec(text);
  return m ? m.index : -1;
}

/** True when the line is evidence of a fault rather than a mention of one. */
function looksLikeError(text: string): boolean {
  if (BENIGN_PATTERN.test(text)) return false;
  if (!ERROR_PATTERN.test(text)) return false;

  const infoAt = firstMatchIndex(INFO_LEVEL, text);
  if (infoAt === -1) return true;

  const errorAt = firstMatchIndex(ERROR_LEVEL, text);
  return errorAt !== -1 && errorAt < infoAt;
}

interface ScanState {
  /** Unix seconds; the daemon is asked only for lines after this. */
  lastReadEpochSec: number;
  /*
   * Consecutive scans that saw at least one error.
   *
   * A better test of "persistently broken" than any rate threshold. Some real
   * failures are slow: a client reconnecting every four minutes produces well
   * under one error per minute, which no sensible rate limit would catch, yet
   * it is unambiguously broken because it never stops. Conversely a burst of
   * twenty errors in one scan and silence afterwards is usually a restart.
   */
  consecutiveScans: number;
}

const state = new Map<string, ScanState>();
let latest: ContainerLogSignal[] = [];
let timer: NodeJS.Timeout | null = null;
let scanning = false;

export function getLogSignals(): ContainerLogSignal[] {
  return latest;
}

async function scanOne(container: ContainerItem, nowSec: number): Promise<ContainerLogSignal | null> {
  const prior = state.get(container.name);
  // First sight of a container looks back one interval, not at its whole life,
  // so a long-running service does not report thousands of historical errors
  // the moment Guardian restarts.
  const since = prior?.lastReadEpochSec ?? nowSec - SCAN_INTERVAL_MS / 1000;
  const windowSec = Math.max(1, nowSec - since);

  try {
    const lines = await fetchContainerLogs(container.id, MAX_LINES, since);

    let stderrLines = 0;
    let errorLines = 0;
    let sample: string | undefined;

    for (const line of lines) {
      if (line.stream === 'stderr') stderrLines += 1;

      const text = line.message;
      if (!text || !looksLikeError(text)) continue;

      errorLines += 1;
      // Keep the first, which is nearest the cause; later lines are usually
      // the same failure repeating or its unwinding.
      if (!sample) sample = text.trim().slice(0, 200);
    }

    const consecutiveScans = errorLines > 0 ? (prior?.consecutiveScans ?? 0) + 1 : 0;
    state.set(container.name, { lastReadEpochSec: nowSec, consecutiveScans });

    if (stderrLines === 0 && errorLines === 0) return null;

    const perMin = (n: number) => Math.round((n / windowSec) * 60 * 10) / 10;

    return {
      name: container.displayName || container.name,
      containerName: container.name,
      stderrPerMin: perMin(stderrLines),
      errorsPerMin: perMin(errorLines),
      errorLines,
      windowSec: Math.round(windowSec),
      consecutiveScans,
      sample,
      checkedAt: Date.now(),
    };
  } catch {
    // A container that stopped mid-scan, or logs we cannot read. Not an error
    // worth surfacing -- its state is already reported elsewhere.
    state.set(container.name, {
      lastReadEpochSec: nowSec,
      consecutiveScans: prior?.consecutiveScans ?? 0,
    });
    return null;
  }
}

export async function runLogScan(containers: ContainerItem[]): Promise<ContainerLogSignal[]> {
  if (scanning) return latest;
  scanning = true;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const targets = containers.filter((c) => c.state === 'running' && !c.hidden);
    const results: ContainerLogSignal[] = [];

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(batch.map((c) => scanOne(c, nowSec)));
      for (const r of settled) if (r) results.push(r);
    }

    // Drop state for containers that no longer exist, so the map cannot grow
    // without bound across recreations.
    const live = new Set(containers.map((c) => c.name));
    for (const key of state.keys()) if (!live.has(key)) state.delete(key);

    latest = results.sort((a, b) => b.errorsPerMin - a.errorsPerMin);
    return latest;
  } catch (err) {
    logger.warn('logscan', 'Log scan failed', { message: (err as Error).message });
    return latest;
  } finally {
    scanning = false;
  }
}

/** Own timer: reading logs for every container must never delay a sample. */
export function startLogScanner(getContainers: () => ContainerItem[]): void {
  if (timer) return;

  const tick = () => {
    const containers = getContainers();
    if (containers.length === 0) return;
    runLogScan(containers).catch(() => {
      // Already logged.
    });
  };

  setTimeout(tick, 45_000).unref();
  timer = setInterval(tick, SCAN_INTERVAL_MS);
  timer.unref();
}

export function stopLogScanner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
