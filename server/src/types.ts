export interface CpuInfo {
  usagePercent: number;
  cores: number[];
  model: string;
  loadAvg: [number, number, number]; // 1m, 5m, 15m
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  buffersBytes: number;
  cachedBytes: number;
  usedPercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  swapPercent: number;
}

export interface DiskMount {
  mountPoint: string;
  label: string;
  device: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  isCritical: boolean; // > 90%
  isWarning: boolean;  // > 80%
}

export interface ThermalSensor {
  name: string;
  label: string;
  tempC: number;
  isCritical: boolean;
}

export interface NetworkInterface {
  name: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxTotalBytes: number;
  txTotalBytes: number;
}

export interface HostTelemetry {
  hostname: string;
  os: string;
  kernel: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disks: DiskMount[];
  thermals: ThermalSensor[];
  network: NetworkInterface[];
  timestamp: number;
}

export interface ContainerPort {
  privatePort: number;
  publicPort?: number;
  type: string;
  ip?: string;
}

export interface ContainerItem {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'dead' | 'created';
  status: string;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  created: number;
  composeProject?: string;
  ports: ContainerPort[];
  cpuPercent?: number;
  memoryBytes?: number;
  memoryLimitBytes?: number;
  // Custom metadata from store
  displayName?: string;
  iconUrl?: string;
  customUrl?: string;
  category?: string;
  hidden?: boolean;
  pinned?: boolean;
  order?: number;
}

export interface CustomAppBookmark {
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  category?: string;
  description?: string;
  pinned?: boolean;
  order?: number;
}

export interface DockerSystemDf {
  imagesTotal: number;
  imagesActive: number;
  imagesSize: number;
  imagesReclaimable: number;
  containersTotal: number;
  containersActive: number;
  containersSize: number;
  volumesTotal: number;
  volumesSize: number;
  volumesReclaimable: number;
  reclaimableTotalBytes: number;
  reclaimableFormatted: string;
}

export interface ServiceProbeResult {
  name: string;
  url: string;
  port: number;
  statusCode: number | null;
  status: 'up' | 'down' | 'unauthorized' | 'redirect';
  latencyMs: number;
  lastChecked: number;
  notes?: string;
}

export interface HistoryPoint {
  timestamp: number;
  cpu: number;
  ram: number;
  netRx: number;
  netTx: number;
  temp: number;
}

export interface DashboardSettings {
  defaultHostMode: 'auto' | 'lan' | 'tailscale' | 'custom';
  lanIp: string;
  tailscaleIp: string;
  customHostUrl?: string;
  refreshIntervalSec: number;
  title: string;
}

export interface UserConfigStore {
  settings: DashboardSettings;
  containers: Record<string, {
    displayName?: string;
    iconUrl?: string;
    customUrl?: string;
    category?: string;
    hidden?: boolean;
    pinned?: boolean;
    order?: number;
  }>;
  customApps: CustomAppBookmark[];
}

/**
 * Where each slice of the payload actually came from. `synthetic` means the
 * collector could not reach the real source and returned sample data, which the
 * UI must label rather than present as a measurement.
 */
export interface DataSources {
  host: 'live' | 'synthetic';
  docker: 'live' | 'synthetic';
}

export interface FullDashboardState {
  host: HostTelemetry;
  containers: ContainerItem[];
  dockerDf: DockerSystemDf | null;
  probes: ServiceProbeResult[];
  config: UserConfigStore;
  history: HistoryPoint[];
  sources: DataSources;
}

/* ------------------------------------------------------------------ *
 * Metric history
 * ------------------------------------------------------------------ */

export type MetricKey = 'cpu' | 'ram' | 'swap' | 'temp' | 'netRx' | 'netTx' | 'disk';

export type HistoryRange = '1h' | '6h' | '24h' | '7d' | '30d';

export interface MetricSample {
  t: number;
  v: Partial<Record<MetricKey, number>>;
}

export interface HistoryPointValue {
  t: number;
  v: number;
}

export interface HistorySeries {
  metric: MetricKey;
  range: HistoryRange;
  resolution: 'fine' | 'medium' | 'coarse';
  bucketMs: number;
  points: HistoryPointValue[];
  stats: {
    min: number;
    max: number;
    avg: number;
    latest: number;
    count: number;
  } | null;
}

/* ------------------------------------------------------------------ *
 * Application logs
 * ------------------------------------------------------------------ */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  t: number;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: unknown;
}

/* ------------------------------------------------------------------ *
 * Power control
 * ------------------------------------------------------------------ */

export type PowerAction = 'shutdown' | 'reboot';

export interface PowerCapability {
  enabled: boolean;
  mechanism: string | null;
  description: string | null;
  inContainer: boolean;
  /** The exact string a caller must echo back to confirm. */
  confirmationPhrase: string;
  reason?: string;
}
