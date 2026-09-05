import fs from 'node:fs';
import path from 'node:path';
import { UserConfigStore, DashboardSettings, CustomAppBookmark } from './types.js';
import { logger } from './logger.js';

const DATA_DIR = process.env.DATA_DIR || '/data';
const CONFIG_FILE = path.join(DATA_DIR, 'guardian.json');
const LOCAL_CONFIG_FILE = path.join(process.cwd(), 'data', 'guardian.json');

const DEFAULT_HOMELAB_ICONS: Record<string, { icon: string; category: string; displayName?: string }> = {
  jellyfin: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/jellyfin.svg',
    category: 'Media',
    displayName: 'Jellyfin Media Server',
  },
  seerr: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/overseerr.svg',
    category: 'Media',
    displayName: 'Seerr Requests',
  },
  radarr: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/radarr.svg',
    category: 'Downloads',
    displayName: 'Radarr Movies',
  },
  sonarr: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/sonarr.svg',
    category: 'Downloads',
    displayName: 'Sonarr TV Shows',
  },
  prowlarr: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/prowlarr.svg',
    category: 'Downloads',
    displayName: 'Prowlarr Indexers',
  },
  bazarr: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/bazarr.svg',
    category: 'Downloads',
    displayName: 'Bazarr Subtitles',
  },
  qbittorrent: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/qbittorrent.svg',
    category: 'Downloads',
    displayName: 'qBittorrent Client',
  },
  homeassistant: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/home-assistant.svg',
    category: 'Automation',
    displayName: 'Home Assistant',
  },
  'home-assistant': {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/home-assistant.svg',
    category: 'Automation',
    displayName: 'Home Assistant',
  },
  'code-server': {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/visual-studio-code.svg',
    category: 'Development',
    displayName: 'VS Code Server',
  },
  gluetun: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/gluetun.svg',
    category: 'System',
    displayName: 'Gluetun VPN Gateway',
  },
  zennotes: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/obsidian.svg',
    category: 'Productivity',
    displayName: 'ZenNotes',
  },
  pelagica: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/audiobookshelf.svg',
    category: 'Media',
    displayName: 'Pelagica',
  },
  cleanuparr: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/recyclarr.svg',
    category: 'Downloads',
    displayName: 'Cleanuparr',
  },
  trawl: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/flaresolverr.svg',
    category: 'Utilities',
    displayName: 'Trawl Solver',
  },
  'llm-wiki-web': {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/ollama.svg',
    category: 'AI & Tools',
    displayName: 'LLM Wiki Web',
  },
  casaos: {
    icon: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/casaos.svg',
    category: 'System',
    displayName: 'CasaOS Portal',
  },
};

const DEFAULT_SETTINGS: DashboardSettings = {
  defaultHostMode: 'auto',
  // Empty unless the operator supplies them. The header only offers a launch
  // target once it is configured, so an unconfigured install shows "Auto"
  // rather than advertising one particular homelab's addresses.
  lanIp: process.env.SERVER_IP || '',
  tailscaleIp: process.env.TAILSCALE_IP || '',
  refreshIntervalSec: 5,
  title: 'Guardian Dashboard',
};

const DEFAULT_CUSTOM_APPS: CustomAppBookmark[] = [
  {
    id: 'app_casaos_host',
    name: 'CasaOS Host Portal',
    url: 'http://{host}:3000',
    iconUrl: 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/casaos.svg',
    category: 'System',
    description: 'CasaOS host dashboard & app store',
    pinned: true,
  },
];

let cachedConfig: UserConfigStore | null = null;

function getConfigPath(): string {
  if (fs.existsSync(DATA_DIR)) {
    return CONFIG_FILE;
  }
  const localDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(localDir)) {
    try {
      fs.mkdirSync(localDir, { recursive: true });
    } catch {
      // Ignore
    }
  }
  return LOCAL_CONFIG_FILE;
}

export function loadUserConfig(): UserConfigStore {
  if (cachedConfig) {
    return cachedConfig;
  }

  const filePath = getConfigPath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      cachedConfig = {
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        containers: parsed.containers || {},
        customApps: parsed.customApps || DEFAULT_CUSTOM_APPS,
      };
      return cachedConfig!;
    }
  } catch (err) {
    logger.warn('store', 'Could not read config file, initialising defaults', err);
  }

  cachedConfig = {
    settings: DEFAULT_SETTINGS,
    containers: {},
    customApps: DEFAULT_CUSTOM_APPS,
  };

  saveUserConfig(cachedConfig);
  return cachedConfig;
}

export function saveUserConfig(config: UserConfigStore): void {
  cachedConfig = config;
  const filePath = getConfigPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Write to a sibling temp file and rename. A crash mid-write would
    // otherwise leave a truncated guardian.json that fails to parse on the next
    // boot, silently resetting every user customisation to defaults.
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    logger.error('store', 'Failed to save config file', err);
  }
}

export function updateContainerConfig(
  containerName: string,
  updates: Partial<UserConfigStore['containers'][string]>
): UserConfigStore {
  const config = loadUserConfig();
  const existing = config.containers[containerName] || {};
  config.containers[containerName] = {
    ...existing,
    ...updates,
  };
  saveUserConfig(config);
  return config;
}

export function addOrUpdateCustomApp(app: CustomAppBookmark): UserConfigStore {
  const config = loadUserConfig();
  const idx = config.customApps.findIndex((a) => a.id === app.id);
  if (idx >= 0) {
    config.customApps[idx] = app;
  } else {
    config.customApps.push(app);
  }
  saveUserConfig(config);
  return config;
}

export function deleteCustomApp(id: string): UserConfigStore {
  const config = loadUserConfig();
  config.customApps = config.customApps.filter((a) => a.id !== id);
  saveUserConfig(config);
  return config;
}

export function updateSettings(settings: Partial<DashboardSettings>): UserConfigStore {
  const config = loadUserConfig();
  config.settings = { ...config.settings, ...settings };
  saveUserConfig(config);
  return config;
}

/* ------------------------------------------------------------------ *
 * Input sanitisation
 *
 * These endpoints write straight to a JSON file that is reloaded on every
 * boot. The handlers used to spread `req.body` in wholesale, so any client
 * could persist arbitrary keys (or a 10 MB string) into the config. Each
 * sanitiser returns `null` when the payload is unusable so the route can
 * answer 400 instead of storing junk.
 * ------------------------------------------------------------------ */

const MAX_STR = 512;

function cleanString(value: unknown, max: number = MAX_STR): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Drops undefined entries so a patch never overwrites a value with `undefined`. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function sanitizeContainerOverride(
  body: unknown
): Partial<UserConfigStore['containers'][string]> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const patch = compact({
    displayName: cleanString(b.displayName, 120),
    iconUrl: cleanString(b.iconUrl, 2048),
    customUrl: cleanString(b.customUrl, 2048),
    category: cleanString(b.category, 60),
    hidden: cleanBool(b.hidden),
    pinned: cleanBool(b.pinned),
    order: typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : undefined,
    integration: cleanString(b.integration, 60),
    integrationConfig: typeof b.integrationConfig === 'object' && b.integrationConfig ? (b.integrationConfig as Record<string, string>) : undefined,
  });

  // An explicitly cleared field should erase the override, not be ignored.
  if (b.iconUrl === '' || b.iconUrl === null) patch.iconUrl = undefined;
  if (b.customUrl === '' || b.customUrl === null) patch.customUrl = undefined;
  if (b.integration === '' || b.integration === null) patch.integration = undefined;

  return patch;
}

export function sanitizeCustomApp(body: unknown): CustomAppBookmark | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const name = cleanString(b.name, 120);
  const url = cleanString(b.url, 2048);
  if (!name || !url) return null;

  return {
    id: cleanString(b.id, 80) || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    url,
    iconUrl: cleanString(b.iconUrl, 2048),
    category: cleanString(b.category, 60) || 'General',
    description: cleanString(b.description, 280),
    pinned: cleanBool(b.pinned) ?? false,
    integration: cleanString(b.integration, 60),
    integrationConfig: typeof b.integrationConfig === 'object' && b.integrationConfig ? (b.integrationConfig as Record<string, string>) : undefined,
  };
}

const HOST_MODES = new Set(['auto', 'lan', 'tailscale', 'custom']);

export function sanitizeSettings(body: unknown): Partial<DashboardSettings> | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const mode = typeof b.defaultHostMode === 'string' && HOST_MODES.has(b.defaultHostMode)
    ? (b.defaultHostMode as DashboardSettings['defaultHostMode'])
    : undefined;

  const interval = Number(b.refreshIntervalSec);

  return compact({
    defaultHostMode: mode,
    lanIp: cleanString(b.lanIp, 255),
    tailscaleIp: cleanString(b.tailscaleIp, 255),
    customHostUrl: cleanString(b.customHostUrl, 255),
    title: cleanString(b.title, 120),
    // Clamped here as well as in the server loop, so a bad value can never be
    // persisted in the first place.
    refreshIntervalSec: Number.isFinite(interval)
      ? Math.min(300, Math.max(2, Math.round(interval)))
      : undefined,
    /*
     * Alert credentials are stored close to verbatim -- only trimmed and length
     * capped. These are opaque tokens, and normalising one to satisfy a stricter
     * parser would break delivery in a way that shows up only when an alert
     * fails to arrive. The phone number is the sole exception, cleaned at send
     * time because operators reasonably type it with spaces.
     */
    alertTelegramBotToken: cleanString(b.alertTelegramBotToken, 200),
    alertTelegramChatId: cleanString(b.alertTelegramChatId, 64),
    alertWhatsappPhone: cleanString(b.alertWhatsappPhone, 32),
    alertWhatsappApiKey: cleanString(b.alertWhatsappApiKey, 64),
    alertMinSeverity:
      b.alertMinSeverity === 'crit' || b.alertMinSeverity === 'warn'
        ? (b.alertMinSeverity as 'crit' | 'warn')
        : undefined,
    alertCooldownMinutes: Number.isFinite(Number(b.alertCooldownMinutes))
      ? Math.min(1440, Math.max(1, Math.round(Number(b.alertCooldownMinutes))))
      : undefined,
  });
}

export function getDefaultIconPreset(name: string): { icon: string; category: string; displayName?: string } | null {
  const clean = name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (DEFAULT_HOMELAB_ICONS[clean]) {
    return DEFAULT_HOMELAB_ICONS[clean];
  }
  for (const [k, v] of Object.entries(DEFAULT_HOMELAB_ICONS)) {
    if (clean.includes(k)) {
      return v;
    }
  }
  return null;
}
