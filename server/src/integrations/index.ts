import http from 'node:http';
import https from 'node:https';
import { AppWidgetData, ContainerItem, CustomAppBookmark } from '../types.js';

interface IntegrationQueryConfig {
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

const widgetCache = new Map<string, { data: AppWidgetData; time: number }>();
const CACHE_TTL_MS = 5000;

function httpFetchJson<T>(urlStr: string, headers: Record<string, string> = {}, timeoutMs: number = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get(
        urlStr,
        {
          headers: {
            'User-Agent': 'Guardian-Integration/1.0',
            Accept: 'application/json',
            ...headers,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(body) as T);
              } catch {
                reject(new Error('Invalid JSON response'));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
    } catch (err) {
      reject(err);
    }
  });
}

function detectIntegrationType(item: ContainerItem | CustomAppBookmark): string | null {
  if (item.integration) return item.integration;
  const name = item.name.toLowerCase();
  const image = ('image' in item ? item.image : '').toLowerCase();

  if (name.includes('plex') || image.includes('plex')) return 'plex';
  if (name.includes('jellyfin') || image.includes('jellyfin')) return 'jellyfin';
  if (name.includes('qbittorrent') || image.includes('qbittorrent')) return 'qbittorrent';
  if (name.includes('transmission') || image.includes('transmission')) return 'transmission';
  if (name.includes('pihole') || name.includes('pi-hole') || image.includes('pihole')) return 'pihole';
  if (name.includes('adguard') || image.includes('adguard')) return 'adguard';
  if (name.includes('radarr') || image.includes('radarr')) return 'radarr';
  if (name.includes('sonarr') || image.includes('sonarr')) return 'sonarr';
  return null;
}

function resolveBaseUrl(item: ContainerItem | CustomAppBookmark, config?: IntegrationQueryConfig): string | null {
  if (config?.url) return config.url.replace(/\/$/, '');
  if ('url' in item && item.url) return item.url.replace(/\/$/, '');

  if ('ports' in item && Array.isArray(item.ports) && item.ports.length > 0) {
    const published = item.ports.find((p) => p.publicPort) || item.ports[0];
    const port = published.publicPort || published.privatePort;
    if (port) return `http://127.0.0.1:${port}`;
  }
  return null;
}

/**
 * Fetches widget telemetry for Plex Media Server.
 */
async function fetchPlexWidget(baseUrl: string, token?: string): Promise<AppWidgetData> {
  const headers: Record<string, string> = token ? { 'X-Plex-Token': token } : {};
  const data = await httpFetchJson<{
    MediaContainer?: {
      size?: number;
      Metadata?: Array<{ title?: string; grandconstraintTop?: string; type?: string }>;
    };
  }>(`${baseUrl}/status/sessions`, headers);

  const sessions = data.MediaContainer?.Metadata || [];
  const count = sessions.length || data.MediaContainer?.size || 0;

  let subtitle: string | undefined;
  if (sessions.length > 0) {
    const first = sessions[0];
    subtitle = first.grandconstraintTop ? `${first.grandconstraintTop} - ${first.title}` : first.title;
  }

  return {
    type: 'media',
    title: 'Plex',
    badge: count === 1 ? '1 Stream' : `${count} Streams`,
    badgeColor: count > 0 ? 'ok' : 'muted',
    subtitle: subtitle || (count > 0 ? 'Active streaming' : 'Idle'),
    metrics: [{ label: 'Active Streams', value: count }],
    updatedAt: Date.now(),
  };
}

/**
 * Fetches widget telemetry for Jellyfin.
 */
async function fetchJellyfinWidget(baseUrl: string, apiKey?: string): Promise<AppWidgetData> {
  const headers: Record<string, string> = apiKey ? { 'X-Emby-Token': apiKey } : {};
  const sessions = await httpFetchJson<
    Array<{ NowPlayingItem?: { Name?: string }; UserName?: string; PlayState?: { IsPaused?: boolean } }>
  >(`${baseUrl}/Sessions`, headers);

  const playing = (Array.isArray(sessions) ? sessions : []).filter((s) => s.NowPlayingItem);
  const count = playing.length;

  let subtitle: string | undefined;
  if (playing.length > 0 && playing[0].NowPlayingItem?.Name) {
    subtitle = playing[0].NowPlayingItem.Name;
  }

  return {
    type: 'media',
    title: 'Jellyfin',
    badge: count === 1 ? '1 Watching' : `${count} Watching`,
    badgeColor: count > 0 ? 'ok' : 'muted',
    subtitle: subtitle || (count > 0 ? 'Active playback' : 'Idle'),
    metrics: [{ label: 'Active', value: count }],
    updatedAt: Date.now(),
  };
}

/**
 * Fetches widget telemetry for qBittorrent.
 */
async function fetchQbittorrentWidget(baseUrl: string): Promise<AppWidgetData> {
  const info = await httpFetchJson<{
    server_state?: {
      dl_info_speed?: number;
      up_info_speed?: number;
      alltime_dl?: number;
    };
    torrents?: Record<string, { state: string; dlspeed: number }>;
  }>(`${baseUrl}/api/v2/sync/maindata`);

  const dlSpeed = info.server_state?.dl_info_speed || 0;
  const upSpeed = info.server_state?.up_info_speed || 0;
  const torrents = Object.values(info.torrents || {});
  const activeCount = torrents.filter((t) => t.dlspeed > 0 || t.state.includes('downloading')).length;

  const formatMBps = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB/s`;
    return `${bytes} B/s`;
  };

  const badge = dlSpeed > 1024 ? `↓ ${formatMBps(dlSpeed)}` : `${torrents.length} Torrents`;

  return {
    type: 'downloads',
    title: 'qBittorrent',
    badge,
    badgeColor: dlSpeed > 1024 ? 'brand' : 'muted',
    subtitle: `${activeCount} active · ${torrents.length} total`,
    metrics: [
      { label: 'Download', value: formatMBps(dlSpeed) },
      { label: 'Upload', value: formatMBps(upSpeed) },
      { label: 'Torrents', value: torrents.length },
    ],
    updatedAt: Date.now(),
  };
}

/**
 * Fetches widget telemetry for Pi-hole.
 */
async function fetchPiholeWidget(baseUrl: string, auth?: string): Promise<AppWidgetData> {
  const authQuery = auth ? `&auth=${encodeURIComponent(auth)}` : '';
  const data = await httpFetchJson<{
    ads_percentage_today?: number;
    dns_queries_today?: number;
    ads_blocked_today?: number;
    status?: string;
  }>(`${baseUrl}/admin/api.php?summaryRaw${authQuery}`);

  const percent = Math.round((data.ads_percentage_today || 0) * 10) / 10;
  const queries = (data.dns_queries_today || 0).toLocaleString();

  return {
    type: 'dns',
    title: 'Pi-hole',
    badge: `${percent}% Blocked`,
    badgeColor: percent > 15 ? 'ok' : 'brand',
    subtitle: `${queries} DNS queries today`,
    metrics: [
      { label: 'Blocked %', value: `${percent}%` },
      { label: 'Total Queries', value: queries },
    ],
    updatedAt: Date.now(),
  };
}

/**
 * Fetches widget telemetry for AdGuard Home.
 */
async function fetchAdGuardWidget(baseUrl: string, username?: string, password?: string): Promise<AppWidgetData> {
  const headers: Record<string, string> = {};
  if (username && password) {
    const b64 = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${b64}`;
  }

  const data = await httpFetchJson<{
    num_dns_queries?: number;
    num_blocked_filtering?: number;
  }>(`${baseUrl}/control/stats`, headers);

  const total = data.num_dns_queries || 0;
  const blocked = data.num_blocked_filtering || 0;
  const percent = total > 0 ? Math.round((blocked / total) * 1000) / 10 : 0;

  return {
    type: 'dns',
    title: 'AdGuard Home',
    badge: `${percent}% Blocked`,
    badgeColor: percent > 15 ? 'ok' : 'brand',
    subtitle: `${total.toLocaleString()} DNS queries`,
    metrics: [
      { label: 'Blocked %', value: `${percent}%` },
      { label: 'Total Queries', value: total.toLocaleString() },
    ],
    updatedAt: Date.now(),
  };
}

/**
 * Fetches widget telemetry for a given app / container.
 */
export async function getAppWidgetData(
  item: ContainerItem | CustomAppBookmark
): Promise<AppWidgetData | null> {
  const type = detectIntegrationType(item);
  if (!type) return null;

  const key = `${type}:${item.id || item.name}`;
  const now = Date.now();
  const cached = widgetCache.get(key);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.data;
  }

  const config: IntegrationQueryConfig = item.integrationConfig || {};
  const baseUrl = resolveBaseUrl(item, config);
  if (!baseUrl) return null;

  try {
    let result: AppWidgetData | null = null;
    switch (type) {
      case 'plex':
        result = await fetchPlexWidget(baseUrl, config.apiKey);
        break;
      case 'jellyfin':
        result = await fetchJellyfinWidget(baseUrl, config.apiKey);
        break;
      case 'qbittorrent':
        result = await fetchQbittorrentWidget(baseUrl);
        break;
      case 'pihole':
        result = await fetchPiholeWidget(baseUrl, config.apiKey);
        break;
      case 'adguard':
        result = await fetchAdGuardWidget(baseUrl, config.username, config.password);
        break;
      default:
        return null;
    }

    if (result) {
      widgetCache.set(key, { data: result, time: now });
      return result;
    }
  } catch {
    // If query fails or app is unreachable, silently omit widget
  }

  return null;
}
