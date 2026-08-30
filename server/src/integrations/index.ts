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
 *
 * Reports *who* is watching and *how*, not just a count. PlayMethod is the
 * signal that matters on a small host: a Transcode session means the CPU is
 * re-encoding in real time, which on a low-power box is the difference between
 * idle and pegged. Those are surfaced as a critical badge so a silent transcode
 * storm is visible before the thermals are.
 */
async function fetchJellyfinWidget(baseUrl: string, apiKey?: string): Promise<AppWidgetData> {
  if (!apiKey) {
    throw new Error('No API key configured (Jellyfin /Sessions requires one)');
  }
  const headers: Record<string, string> = { 'X-Emby-Token': apiKey };
  const sessions = await httpFetchJson<
    Array<{
      UserName?: string;
      DeviceName?: string;
      Client?: string;
      NowPlayingItem?: { Name?: string; SeriesName?: string; Type?: string };
      PlayState?: { IsPaused?: boolean; PlayMethod?: string };
    }>
  >(`${baseUrl}/Sessions`, headers);

  const playing = (Array.isArray(sessions) ? sessions : []).filter((s) => s.NowPlayingItem);
  const count = playing.length;

  const isTranscode = (s: (typeof playing)[number]) => s.PlayState?.PlayMethod === 'Transcode';
  const transcoding = playing.filter(isTranscode).length;
  const direct = count - transcoding;

  // "alice - The Bear S03E01" / "bob - Dune (paused)"
  const describe = (s: (typeof playing)[number]) => {
    const item = s.NowPlayingItem || {};
    const title = item.SeriesName ? `${item.SeriesName} - ${item.Name}` : item.Name || 'Unknown';
    const who = s.UserName || 'unknown';
    const flags: string[] = [];
    if (s.PlayState?.IsPaused) flags.push('paused');
    if (isTranscode(s)) flags.push('transcoding');
    return `${who} - ${title}${flags.length ? ` (${flags.join(', ')})` : ''}`;
  };

  const metrics: Array<{ label: string; value: string | number }> = [
    { label: 'Watching', value: count },
    { label: 'Direct', value: direct },
    { label: 'Transcoding', value: transcoding },
  ];
  // One row per viewer, so the dashboard answers "who" without opening Jellyfin.
  for (const s of playing.slice(0, 4)) {
    metrics.push({ label: s.UserName || 'unknown', value: describe(s).replace(/^[^-]+ - /, '') });
  }

  return {
    type: 'media',
    title: 'Jellyfin',
    badge: transcoding > 0 ? `${transcoding} Transcoding` : count === 1 ? '1 Watching' : `${count} Watching`,
    badgeColor: transcoding > 0 ? 'crit' : count > 0 ? 'ok' : 'muted',
    subtitle: count > 0 ? playing.map(describe).join(' · ') : 'Idle',
    statusText: transcoding > 0 ? 'Transcoding - CPU is re-encoding in real time' : undefined,
    metrics,
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
 * Fetches widget telemetry for Radarr / Sonarr.
 *
 * Two questions the dashboard should answer without opening the app: what is
 * downloading right now, and is the instance complaining about anything.
 * `/queue` covers the first, `/health` the second -- and a stalled or errored
 * grab is escalated to a warning badge, because a queue that is "full" but
 * making no progress looks identical to a healthy one at a glance.
 */
async function fetchArrWidget(baseUrl: string, apiKey: string | undefined, label: string): Promise<AppWidgetData> {
  if (!apiKey) {
    throw new Error(`No API key configured (${label} requires one)`);
  }
  const headers = { 'X-Api-Key': apiKey };

  const queue = await httpFetchJson<{
    totalRecords?: number;
    records?: Array<{
      title?: string;
      status?: string;
      trackedDownloadStatus?: string;
      size?: number;
      sizeleft?: number;
      errorMessage?: string;
    }>;
  }>(`${baseUrl}/api/v3/queue?pageSize=50`, headers);

  // Health is advisory: if it fails we still want the queue widget.
  let warnings = 0;
  try {
    const health = await httpFetchJson<Array<{ type?: string }>>(`${baseUrl}/api/v3/health`, headers);
    warnings = (Array.isArray(health) ? health : []).filter((h) => h.type !== 'ok').length;
  } catch {
    warnings = -1;
  }

  const records = queue.records || [];
  const total = queue.totalRecords ?? records.length;
  const downloading = records.filter((r) => (r.status || '').toLowerCase() === 'downloading').length;
  const problems = records.filter(
    (r) => r.trackedDownloadStatus === 'warning' || r.trackedDownloadStatus === 'error' || r.errorMessage
  ).length;

  // Aggregate progress, so "3 downloading" comes with a percentage.
  const totalSize = records.reduce((a, r) => a + (r.size || 0), 0);
  const totalLeft = records.reduce((a, r) => a + (r.sizeleft || 0), 0);
  const pct = totalSize > 0 ? Math.round(((totalSize - totalLeft) / totalSize) * 100) : 0;

  const metrics: Array<{ label: string; value: string | number }> = [
    { label: 'Queue', value: total },
    { label: 'Downloading', value: downloading },
  ];
  if (totalSize > 0) metrics.push({ label: 'Progress', value: `${pct}%` });
  if (warnings >= 0) metrics.push({ label: 'Health', value: warnings === 0 ? 'OK' : `${warnings} warning(s)` });
  for (const r of records.slice(0, 3)) {
    if (r.title) metrics.push({ label: r.status || 'queued', value: r.title.slice(0, 60) });
  }

  const badgeColor: AppWidgetData['badgeColor'] =
    problems > 0 ? 'crit' : warnings > 0 ? 'warn' : downloading > 0 ? 'brand' : 'muted';

  return {
    type: 'arr',
    title: label,
    badge: downloading > 0 ? `${downloading} Downloading` : total > 0 ? `${total} Queued` : 'Idle',
    badgeColor,
    subtitle:
      records.length > 0
        ? `${records[0].title?.slice(0, 70) || 'unknown'}${totalSize > 0 ? ` - ${pct}%` : ''}`
        : warnings > 0
          ? `${warnings} health warning(s)`
          : 'Queue empty',
    statusText: problems > 0 ? `${problems} stalled or errored item(s)` : undefined,
    metrics,
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
      case 'radarr':
        result = await fetchArrWidget(baseUrl, config.apiKey, 'Radarr');
        break;
      case 'sonarr':
        result = await fetchArrWidget(baseUrl, config.apiKey, 'Sonarr');
        break;
      default:
        return null;
    }

    if (result) {
      widgetCache.set(key, { data: result, time: now });
      return result;
    }
  } catch (err) {
    /*
     * Previously this returned null, which made a missing API key, an
     * unreachable host and a genuinely idle app render identically -- no
     * widget, no explanation. A broken integration should look broken.
     */
    const message = (err as Error)?.message || 'Unknown error';
    const failed: AppWidgetData = {
      type: 'custom',
      title: item.name,
      badge: 'Unavailable',
      badgeColor: 'warn',
      subtitle: message.slice(0, 120),
      statusText: `${type} integration failed`,
      updatedAt: Date.now(),
    };
    widgetCache.set(key, { data: failed, time: now });
    return failed;
  }

  return null;
}
