export interface CpuInfo {
  usagePercent: number;
  cores: number[];
  model: string;
  loadAvg: [number, number, number]; // 1m, 5m, 15m
  /** Time blocked on disk. On an I/O-bound host this is the number that matters. */
  iowaitPercent: number;
  /** Time stolen by the hypervisor. Non-zero only on virtualised hosts. */
  stealPercent: number;
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
  tempC?: number;
}

export interface ThermalSensor {
  name: string;
  label: string;
  tempC: number;
  isCritical: boolean;
}

export interface FanSensor {
  name: string;
  label: string;
  rpm: number;
}

export interface GpuTelemetry {
  id: string;
  name: string;
  driver?: string;
  utilizationPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryPercent: number;
  temperatureC?: number;
  powerWatts?: number;
  fanSpeedPercent?: number;
}

export interface WanTelemetry {
  publicIp?: string;
  isp?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  pingMs?: number;
  lastChecked?: number;
}

export interface SpeedtestResult {
  id: string;
  timestamp: number;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs?: number;
  server?: string;
}

export interface SpeedtestProgress {
  phase: 'idle' | 'ping' | 'download' | 'upload' | 'complete' | 'error';
  currentMbps: number;
  progressPercent: number;
  downloadMbps?: number;
  uploadMbps?: number;
  pingMs?: number;
  error?: string;
}

export type AppWidgetType = 'media' | 'downloads' | 'dns' | 'arr' | 'custom';

export interface AppWidgetData {
  type: AppWidgetType;
  title?: string;
  subtitle?: string;
  statusText?: string;
  badge?: string;
  badgeColor?: 'ok' | 'warn' | 'crit' | 'brand' | 'muted';
  metrics?: Array<{ label: string; value: string | number }>;
  updatedAt: number;
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
  packageTempC?: number;
  memory: MemoryInfo;
  disks: DiskMount[];
  thermals: ThermalSensor[];
  fans?: FanSensor[];
  gpu?: GpuTelemetry[];
  wan?: WanTelemetry;
  network: NetworkInterface[];
  timestamp: number;
}

export interface ContainerPort {
  privatePort: number;
  publicPort?: number;
  type: string;
  ip?: string;
}

export interface HealthProbe {
  start: number;
  exitCode: number;
  output: string;
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
  networkRxBytesPerSec?: number;
  networkTxBytesPerSec?: number;
  /** Age of the stats sample in ms; large values mean the stream is stalled. */
  statAgeMs?: number;

  /* From /containers/{id}/json — the diagnostic half of a container's state. */
  restartCount?: number;
  exitCode?: number;
  /** Last error string the daemon recorded for this container. */
  stateError?: string;
  oomKilled?: boolean;
  startedAt?: number;
  finishedAt?: number;
  /** Recent healthcheck probes, newest last. */
  healthLog?: HealthProbe[];
  /** e.g. "bridge", "host", or "container:gluetun" for a shared namespace. */
  networkMode?: string;
  /** Resolved when networkMode points at another container. */
  networkParent?: string;
  // Custom metadata from store
  displayName?: string;
  iconUrl?: string;
  customUrl?: string;
  category?: string;
  hidden?: boolean;
  pinned?: boolean;
  order?: number;
  integration?: string;
  integrationConfig?: Record<string, string>;
  widget?: AppWidgetData;
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
  integration?: string;
  integrationConfig?: Record<string, string>;
  widget?: AppWidgetData;
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

  /*
   * Reclaimable space, split by what it actually takes to reclaim it.
   *
   * The prune button removes dangling images only, so reporting one combined
   * figure meant the banner promised space the button could never free — and
   * then kept asking after the user had already pruned everything it could.
   */
  /** Untagged layers. Safe to remove; this is what "Prune" frees. */
  danglingBytes: number;
  danglingCount: number;
  /** Tagged images no container uses. Removing them means re-pulling. */
  unusedTaggedBytes: number;
  unusedTaggedCount: number;
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
    integration?: string;
    integrationConfig?: Record<string, string>;
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

/* ------------------------------------------------------------------ *
 * Process telemetry
 * ------------------------------------------------------------------ */

export interface ProcessItem {
  pid: number;
  ppid?: number;
  user: string;
  name: string;
  cmd: string;
  cpuPercent: number;
  memPercent: number;
  memBytes: number;
  netRxBytesPerSec?: number;
  netTxBytesPerSec?: number;
}
