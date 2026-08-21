export interface CpuInfo {
  usagePercent: number;
  cores: number[];
  model: string;
  loadAvg: [number, number, number];
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
  isCritical: boolean;
  isWarning: boolean;
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
}
