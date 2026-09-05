import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../types/dashboard';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number, decimals: number = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = Math.max(0, decimals);
  // Clamp so a pathological value can never index past the unit table.
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), BYTE_UNITS.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${BYTE_UNITS[i]}`;
}

const RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];

export function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(k)), RATE_UNITS.length - 1);
  return `${parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1))} ${RATE_UNITS[i]}`;
}

export function formatUptime(seconds: number): string {
  if (!seconds) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/** Compact "12s ago" / "4m ago" for freshness indicators. */
export function formatAgo(timestamp?: number): string {
  if (!timestamp) return '—';
  const sec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------ *
 * Severity
 *
 * One place decides whether a number is fine, worth noticing, or urgent.
 * Components ask for a severity and map it to a token, so colour in the UI
 * always encodes state rather than taste.
 * ------------------------------------------------------------------ */

export type Severity = 'ok' | 'warn' | 'crit';

export function severityFor(value: number, warnAt: number, critAt: number): Severity {
  if (value >= critAt) return 'crit';
  if (value >= warnAt) return 'warn';
  return 'ok';
}

/** Foreground colour for a metric readout. `ok` stays neutral on purpose:
 *  a healthy dashboard should be almost entirely monochrome. */
export function severityTextClass(severity: Severity): string {
  switch (severity) {
    case 'crit':
      return 'text-crit';
    case 'warn':
      return 'text-warn';
    default:
      return 'text-foreground';
  }
}

export function severityBarClass(severity: Severity): string {
  switch (severity) {
    case 'crit':
      return 'bg-crit';
    case 'warn':
      return 'bg-warn';
    default:
      return 'bg-brand';
  }
}

export function severityDotClass(severity: Severity): string {
  switch (severity) {
    case 'crit':
      return 'bg-crit';
    case 'warn':
      return 'bg-warn';
    default:
      return 'bg-ok';
  }
}

/* ------------------------------------------------------------------ *
 * Host / URL resolution
 * ------------------------------------------------------------------ */

/** Browser-derived host, used whenever settings do not pin an explicit one. */
function browserHost(): string {
  return window.location.hostname || 'localhost';
}

export function getActiveHost(settings?: DashboardSettings): string {
  if (!settings) return browserHost();

  const mode = settings.defaultHostMode;
  if (mode === 'lan' && settings.lanIp) return settings.lanIp;
  if (mode === 'tailscale' && settings.tailscaleIp) return settings.tailscaleIp;
  if (mode === 'custom' && settings.customHostUrl) return settings.customHostUrl;

  // Auto: trust the address the dashboard is already being served from, since
  // that is provably reachable from this browser. Fall back to the configured
  // LAN address only when served from loopback.
  const current = window.location.hostname;
  if (current && current !== 'localhost' && current !== '127.0.0.1' && current !== '[::1]') {
    return current;
  }
  return settings.lanIp || browserHost();
}

/** Expand {host} / {lan} / {tailscale} and ensure a scheme is present. */
function expandTemplate(raw: string, settings?: DashboardSettings): string {
  const activeHost = getActiveHost(settings);
  let url = raw.trim();

  // Replace every occurrence, not just the first -- a URL may reference the
  // same placeholder more than once.
  url = url.replace(/\{host\}/g, activeHost);
  url = url.replace(/\{lan\}/g, settings?.lanIp || activeHost);
  url = url.replace(/\{tailscale\}/g, settings?.tailscaleIp || activeHost);

  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

export function resolveContainerUrl(
  container: ContainerItem,
  settings?: DashboardSettings,
  selectedPort?: number
): string | null {
  if (container.customUrl && container.customUrl.trim() !== '') {
    return expandTemplate(container.customUrl, settings);
  }

  let portToUse = selectedPort;
  if (!portToUse && container.ports && container.ports.length > 0) {
    const published = container.ports.find((p) => p.publicPort);
    portToUse = published ? published.publicPort : container.ports[0].privatePort;
  }

  if (portToUse) {
    return `http://${getActiveHost(settings)}:${portToUse}`;
  }
  return null;
}

export function resolveBookmarkUrl(
  app: CustomAppBookmark,
  settings?: DashboardSettings
): string {
  return expandTemplate(app.url || '', settings);
}

/* ------------------------------------------------------------------ *
 * Container attention
 *
 * One place decides whether a container needs looking at, so the grid, the
 * ordering and the summary line can never disagree about what "a problem" is.
 * ------------------------------------------------------------------ */


export interface ContainerIssue {
  severity: Severity;
  /** Short label for the card. */
  label: string;
  /** Fuller explanation for a tooltip. */
  detail: string;
}

/** Restarts above this in a container's lifetime read as a loop, not a blip. */
const RESTART_LOOP_THRESHOLD = 3;

export function containerIssues(c: ContainerItem): ContainerIssue[] {
  const issues: ContainerIssue[] = [];

  if (c.oomKilled) {
    issues.push({
      severity: 'crit',
      label: 'OOM killed',
      detail: 'The kernel killed this container for exceeding its memory limit.',
    });
  }

  if (c.health === 'unhealthy') {
    const lastProbe = c.healthLog?.[c.healthLog.length - 1];
    issues.push({
      severity: 'crit',
      label: 'Unhealthy',
      detail: lastProbe?.output
        ? `Healthcheck failing: ${lastProbe.output}`
        : 'The container healthcheck is failing.',
    });
  }

  if (c.state === 'restarting') {
    issues.push({ severity: 'crit', label: 'Restarting', detail: 'Container is restarting now.' });
  }

  if (c.state === 'dead') {
    issues.push({ severity: 'crit', label: 'Dead', detail: 'Container is in a dead state.' });
  }

  // A restart-looping container reports "running" between restarts, which is
  // why this has to be derived from the count rather than the state.
  if ((c.restartCount ?? 0) >= RESTART_LOOP_THRESHOLD) {
    issues.push({
      severity: c.state === 'running' ? 'warn' : 'crit',
      label: `${c.restartCount} restarts`,
      detail: `Restarted ${c.restartCount} times. A container that keeps restarting still reports "running" in between.`,
    });
  }

  if (c.state === 'exited' && (c.exitCode ?? 0) !== 0) {
    issues.push({
      severity: 'warn',
      label: `Exit ${c.exitCode}`,
      detail: c.stateError || `Container exited with code ${c.exitCode}.`,
    });
  }

  /*
   * Only meaningful against a limit the operator actually set. For an
   * unconstrained container the cgroup reports total host RAM as the "limit",
   * which turned this into "% of host RAM" and warned about containers that
   * were behaving perfectly well.
   */
  if (c.memoryLimitIsExplicit && c.memoryLimitBytes && c.memoryBytes && c.memoryLimitBytes > 0) {
    const share = (c.memoryBytes / c.memoryLimitBytes) * 100;
    if (share >= 90) {
      issues.push({
        severity: 'warn',
        label: `${share.toFixed(0)}% of limit`,
        detail: `Using ${share.toFixed(0)}% of its memory limit — the next spike may trigger an OOM kill.`,
      });
    }
  }

  /*
   * Being throttled is not the same as being busy. A container pinned against
   * its own quota is slow for a reason you can fix by raising the cap, which is
   * invisible if all you see is a CPU percentage measured against the host.
   */
  if (c.cpuThrottlingNow) {
    issues.push({
      severity: 'warn',
      label: 'CPU throttled',
      detail: c.cpuLimitCores
        ? `Held at its ${c.cpuLimitCores} CPU limit by the kernel. Raise the cap or reduce its work.`
        : 'The kernel is throttling this container against its CPU quota.',
    });
  } else if ((c.cpuPercentOfLimit ?? 0) >= 90) {
    issues.push({
      severity: 'warn',
      label: `${(c.cpuPercentOfLimit ?? 0).toFixed(0)}% of CPU cap`,
      detail: `Using ${(c.cpuPercentOfLimit ?? 0).toFixed(0)}% of its ${c.cpuLimitCores} CPU allowance — close to being throttled.`,
    });
  }

  return issues;
}

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, ok: 2 };

/** Worst issue severity, or `ok` when there is nothing to report. */
export function containerSeverity(c: ContainerItem): Severity {
  return containerIssues(c).reduce<Severity>(
    (worst, issue) => (SEVERITY_RANK[issue.severity] < SEVERITY_RANK[worst] ? issue.severity : worst),
    'ok'
  );
}

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}
