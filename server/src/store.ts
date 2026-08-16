import fs from 'node:fs';
import path from 'node:path';
import { UserConfigStore, DashboardSettings, CustomAppBookmark } from './types.js';

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
  lanIp: process.env.SERVER_IP || '192.168.0.26',
  tailscaleIp: process.env.TAILSCALE_IP || '100.94.238.9',
  refreshIntervalSec: 15,
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
    console.warn('[Store] Could not read config file, initializing defaults:', (err as Error).message);
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
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Store] Failed to save config file:', (err as Error).message);
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
