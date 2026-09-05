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
  /*
   * Swap *traffic*, from /proc/vmstat. Occupancy alone cannot distinguish a
   * host that paged something out hours ago and moved on from one that is
   * thrashing right now -- both sit at a constant percentage. Sustained
   * non-zero in both directions is the signature of thrashing.
   */
  swapInBytesPerSec?: number;
  swapOutBytesPerSec?: number;
}

/**
 * Linux pressure-stall information, from /proc/pressure/{cpu,io,memory}.
 *
 * `some` is the share of time at least one task was stalled on the resource;
 * `full` is the share where every task was. On a small box `io.some` climbing
 * while CPU sits near zero is the clearest statement that the disks, not the
 * processor, are the constraint -- iowait says the same thing far less
 * legibly. Absent on kernels built without CONFIG_PSI.
 */
export interface PressureMetric {
  some10: number;
  some60: number;
  full10: number;
  full60: number;
}

export interface PressureInfo {
  cpu?: PressureMetric;
  io?: PressureMetric;
  memory?: PressureMetric;
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

/**
 * Projected fill trajectory for one filesystem.
 *
 * `direction` is deliberately coarse and `daysUntilFull` deliberately absent
 * unless the fit is worth trusting: a confident-looking projection built from
 * two noisy points is worse than none.
 */
export interface DiskTrend {
  mountPoint: string;
  /** Signed; negative means the volume is being reclaimed. */
  bytesPerDay: number;
  direction: 'filling' | 'draining' | 'stable';
  /** Only present when filling, and only when the answer is under a year. */
  daysUntilFull?: number;
  sampleCount: number;
  spanHours: number;
}

/** One top-level folder in a download root. */
export interface ReclaimEntry {
  name: string;
  path: string;
  bytes: number;
  fileCount: number;
  /** The download client still has a torrent pointing at this path. */
  isActive: boolean;
  torrentState?: string;
  /** Download finished (seeding). Only these are fair evidence about linking. */
  isSeeding: boolean;
  /** Files with nlink > 1, i.e. already hard-linked into a library. */
  linkedFiles: number;
  linkedBytes: number;
  reclaimable: boolean;
}

/**
 * Cross-reference of what is on the download volume against what the download
 * client still knows about. Report-only; see collectors/reclaim.ts.
 */
export interface ReclaimReport {
  generatedAt: number;
  roots: string[];
  scannedRoots: number;
  totalBytes: number;
  entries: ReclaimEntry[];
  reclaimableBytes: number;
  reclaimableCount: number;
  totalFiles: number;
  /** How many files are shared with a library rather than duplicated. */
  linkedFiles: number;
  /* Restricted to finished downloads, which is the only fair denominator for
   * "are imports linking or copying?". */
  finishedFiles: number;
  finishedLinkedFiles: number;
  /** Bytes held by finished downloads that share nothing with a library. */
  finishedUnlinkedBytes: number;
  source: string;
}

export type Severity = 'ok' | 'warn' | 'crit';

/** A single thing currently wrong, from any source. See problems.ts. */
export interface Problem {
  /** Stable across samples and keyed on the subject, never the reading. */
  id: string;
  severity: Severity;
  scope: 'host' | 'disk' | 'container' | 'probe';
  label: string;
  detail: string;
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
  /** Current and maximum render-clock, where the driver exposes them. */
  clockMhz?: number;
  clockMaxMhz?: number;
  /** True when the GPU shares system RAM, so the memory fields carry no meaning. */
  sharedMemory?: boolean;
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

/**
 * Intel thermal-throttle counters from
 * `/sys/devices/system/cpu/cpu*\/thermal_throttle`.
 *
 * Temperature alone does not tell you whether the CPU actually gave up clock
 * speed -- a box can sit at 95C and still run flat out, or throttle hard in
 * short bursts that a 15-second temperature sample never catches. These are
 * monotonic counters, so a rising `coreEvents` between samples is proof the
 * silicon stepped down.
 */
export interface CpuThrottle {
  coreEvents: number;
  packageEvents: number;
  coreTotalTimeMs: number;
  packageTotalTimeMs: number;
  currentMhz?: number;
  maxMhz?: number;
  /** True when the counters moved since the previous sample. */
  throttlingNow: boolean;
}

/**
 * Battery and mains state, from `/sys/class/power_supply`.
 *
 * On a laptop pressed into service as a server this is effectively a built-in
 * UPS: `onMains: false` means the machine is running on battery and you have a
 * bounded amount of time to react. This kernel does not expose `energy_now` or
 * `power_now` on this hardware, so a runtime estimate is not always possible --
 * `minutesRemaining` is therefore optional rather than guessed at.
 */
export interface BatteryTelemetry {
  present: boolean;
  onMains: boolean;
  chargePercent?: number;
  status?: string;
  technology?: string;
  cycleCount?: number;
  minutesRemaining?: number;
}

/**
 * Per-device block I/O, derived from `/proc/diskstats` deltas.
 *
 * I/O wait tells you the host is blocked on storage but not which device is
 * responsible. `utilPercent` comes from the kernel's io_ms counter -- the share
 * of wall-clock during which the queue was non-empty -- which is the same
 * number iostat calls %util.
 */
export interface DiskIo {
  device: string;
  readBytesPerSec: number;
  writeBytesPerSec: number;
  readIopsPerSec: number;
  writeIopsPerSec: number;
  utilPercent: number;
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
  throttle?: CpuThrottle;
  battery?: BatteryTelemetry;
  diskIo?: DiskIo[];
  gpu?: GpuTelemetry[];
  wan?: WanTelemetry;
  pressure?: PressureInfo;
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
  /** True when the operator set an explicit `-m`; otherwise the limit is host RAM. */
  memoryLimitIsExplicit?: boolean;
  /** Cores this container may use, when capped. */
  cpuLimitCores?: number;
  /** Share of its own CPU allowance, not of the host. */
  cpuPercentOfLimit?: number;
  /** cgroup throttling counter rose since the previous sample. */
  cpuThrottlingNow?: boolean;
  networkRxBytesPerSec?: number;
  networkTxBytesPerSec?: number;
  blockReadBytesPerSec?: number;
  blockWriteBytesPerSec?: number;
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
  /** Where to POST alerts. Empty disables alerting entirely. */
  alertWebhookUrl?: string;
  /** Only notify at or above this severity. Defaults to warn. */
  alertMinSeverity?: 'warn' | 'crit';
  /** How long before an unresolved problem is mentioned again. */
  alertCooldownMinutes?: number;
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
  /** Everything currently wrong, worst first. */
  problems?: Problem[];
  /** Download-volume cross-reference. Absent until the first slow scan. */
  reclaim?: ReclaimReport;
  /** Fill projections, keyed by mount point. Absent until enough history exists. */
  diskTrends?: DiskTrend[];
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
