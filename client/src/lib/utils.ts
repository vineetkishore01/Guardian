import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../types/dashboard';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec === 0 || !bytesPerSec) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  const clampedIdx = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytesPerSec / Math.pow(k, clampedIdx)).toFixed(1))} ${sizes[clampedIdx]}`;
}

export function formatUptime(seconds: number): string {
  if (!seconds) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export function getActiveHost(settings?: DashboardSettings): string {
  if (!settings) {
    return window.location.hostname || '192.168.0.26';
  }

  const mode = settings.defaultHostMode;
  if (mode === 'lan') return settings.lanIp || '192.168.0.26';
  if (mode === 'tailscale') return settings.tailscaleIp || '100.94.238.9';
  if (mode === 'custom' && settings.customHostUrl) return settings.customHostUrl;

  // Auto mode: use current browser hostname if valid, otherwise LAN IP
  const currentHost = window.location.hostname;
  if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
    return currentHost;
  }
  return settings.lanIp || '192.168.0.26';
}

export function resolveContainerUrl(
  container: ContainerItem,
  settings?: DashboardSettings,
  selectedPort?: number
): string | null {
  const activeHost = getActiveHost(settings);

  // 1. If custom URL is set, resolve placeholders
  if (container.customUrl && container.customUrl.trim() !== '') {
    let url = container.customUrl.trim();
    url = url.replace('{host}', activeHost);
    url = url.replace('{lan}', settings?.lanIp || '192.168.0.26');
    url = url.replace('{tailscale}', settings?.tailscaleIp || '100.94.238.9');

    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    return url;
  }

  // 2. Resolve port
  let portToUse = selectedPort;
  if (!portToUse && container.ports && container.ports.length > 0) {
    const published = container.ports.find((p) => p.publicPort);
    portToUse = published ? published.publicPort : container.ports[0].privatePort;
  }

  if (portToUse) {
    return `http://${activeHost}:${portToUse}`;
  }

  return null;
}

export function resolveBookmarkUrl(
  app: CustomAppBookmark,
  settings?: DashboardSettings
): string {
  const activeHost = getActiveHost(settings);
  let url = app.url.trim();
  url = url.replace('{host}', activeHost);
  url = url.replace('{lan}', settings?.lanIp || '192.168.0.26');
  url = url.replace('{tailscale}', settings?.tailscaleIp || '100.94.238.9');

  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}
