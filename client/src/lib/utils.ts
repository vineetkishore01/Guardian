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
  return `${Math.floor(min / 60)}h ago`;
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
