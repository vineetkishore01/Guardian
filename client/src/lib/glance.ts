import {
  ContainerItem,
  DiskMount,
  DockerSystemDf,
  HostTelemetry,
  PhysicalDisk,
  Problem,
} from '../types/dashboard';
import { containerSeverity, formatBytes, Severity } from './utils';

/*
 * Everything the "Glance" tier shows is derived here, from live telemetry and
 * nowhere else. Components render these shapes; they never recompute them, so
 * the verdict line, the KPI blocks and the nav badges cannot disagree.
 */

/** Dangling layers below this are not worth a chip: the prune is noise. */
export const PRUNE_THRESHOLD_BYTES = 512 * 1024 * 1024;

export function isPruneWorthwhile(df?: DockerSystemDf | null): boolean {
  return (df?.danglingBytes ?? 0) >= PRUNE_THRESHOLD_BYTES;
}

/* ------------------------------ containers ------------------------------ */

export interface FleetSummary {
  total: number;
  running: number;
  /** Cleanly stopped: exited/created with nothing wrong. Collapsed in the table. */
  stopped: number;
  unhealthy: number;
  restarting: number;
  /** Anything with a crit/warn issue, including the two above. */
  flagged: number;
}

/**
 * A stopped container is only "quiet" if nothing is wrong with it. One that
 * crashed (non-zero exit) or was OOM-killed must stay in view, so it is excluded
 * here and keeps its full row in the table.
 */
export function isQuietlyStopped(c: ContainerItem): boolean {
  return (c.state === 'exited' || c.state === 'created') && containerSeverity(c) === 'ok';
}

export function summarizeFleet(containers: ContainerItem[]): FleetSummary {
  const visible = containers.filter((c) => !c.hidden);
  return {
    total: visible.length,
    running: visible.filter((c) => c.state === 'running').length,
    stopped: visible.filter(isQuietlyStopped).length,
    unhealthy: visible.filter((c) => c.health === 'unhealthy').length,
    restarting: visible.filter((c) => c.state === 'restarting').length,
    flagged: visible.filter((c) => containerSeverity(c) !== 'ok').length,
  };
}

/* -------------------------------- storage -------------------------------- */

export interface StorageSummary {
  usedPercent: number;
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
  tightest: DiskMount;
  volumeCount: number;
}

/**
 * Aggregate across volumes. Bind mounts and btrfs subvolumes show the same
 * device several times, so capacity is counted once per device -- otherwise the
 * "headroom" figure would multiply.
 */
export function summarizeStorage(disks: DiskMount[]): StorageSummary | null {
  if (disks.length === 0) return null;

  const byDevice = new Map<string, DiskMount>();
  for (const d of disks) {
    const key = d.device || d.mountPoint;
    const existing = byDevice.get(key);
    if (!existing || d.totalBytes > existing.totalBytes) byDevice.set(key, d);
  }
  const unique = [...byDevice.values()];

  const totalBytes = unique.reduce((s, d) => s + d.totalBytes, 0);
  const usedBytes = unique.reduce((s, d) => s + d.usedBytes, 0);
  const freeBytes = unique.reduce((s, d) => s + d.freeBytes, 0);
  const tightest = disks.reduce((worst, d) => (d.usedPercent > worst.usedPercent ? d : worst));

  return {
    usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    usedBytes,
    totalBytes,
    freeBytes,
    tightest,
    volumeCount: unique.length,
  };
}

export function hottestDrive(disks?: PhysicalDisk[]): PhysicalDisk | null {
  const withTemp = (disks ?? []).filter((d) => d.tempC !== undefined && Number.isFinite(d.tempC));
  if (withTemp.length === 0) return null;
  return withTemp.reduce((hot, d) => ((d.tempC ?? 0) > (hot.tempC ?? 0) ? d : hot));
}

/* --------------------------------- memory -------------------------------- */

export interface MemoryBreakdown {
  /** Application (anonymous) memory. */
  appBytes: number;
  /** Reclaimable page cache + buffers. */
  cacheBytes: number;
  freeBytes: number;
  /** Slab, kernel stacks, page tables, shmem overlap etc. -- the unexplained rest. */
  otherBytes: number;
  totalBytes: number;
  /** False when the host did not report anon memory and the split is a guess. */
  detailed: boolean;
}

/**
 * Splits RAM into app / cache / free / other.
 *
 * Application memory is Active(anon) + Inactive(anon): Active(anon) alone leaves
 * out pages merely untouched for a while, which would make a busy host look
 * emptier than it is. When the kernel does not report them (no /proc/meminfo,
 * stripped containers) the split degrades to used-vs-free rather than inventing
 * a breakdown.
 */
export function breakdownMemory(m: HostTelemetry['memory']): MemoryBreakdown {
  const total = Math.max(m.totalBytes, 1);
  const free = Math.min(m.freeBytes, total);

  if (m.activeAnonBytes === undefined || m.pageCacheBytes === undefined) {
    return {
      appBytes: Math.min(m.usedBytes, total),
      cacheBytes: 0,
      freeBytes: free,
      otherBytes: Math.max(0, total - Math.min(m.usedBytes, total) - free),
      totalBytes: total,
      detailed: false,
    };
  }

  const app = Math.min((m.activeAnonBytes ?? 0) + (m.inactiveAnonBytes ?? 0), total);
  const cache = Math.min(m.pageCacheBytes, total - app);
  const other = Math.max(0, total - app - cache - free);
  return { appBytes: app, cacheBytes: cache, freeBytes: free, otherBytes: other, totalBytes: total, detailed: true };
}

/* --------------------------------- compute ------------------------------- */

/** Load per thread: 1.0 means every thread is busy on average. */
export function loadSeverity(load1: number, threads: number): Severity {
  if (threads <= 0) return 'ok';
  const perThread = load1 / threads;
  if (perThread >= 1.5) return 'crit';
  if (perThread >= 0.9) return 'warn';
  return 'ok';
}

export function packageTemp(host: HostTelemetry): number | undefined {
  if (host.packageTempC !== undefined) return host.packageTempC;
  const sensor = host.thermals.find((t) => /pkg|package|cpu|tctl|core/i.test(t.label));
  return sensor?.tempC;
}

/* --------------------------------- verdict ------------------------------- */

export type PulseLevel = 'ok' | 'warn' | 'crit' | 'sample';

export interface Verdict {
  level: PulseLevel;
  text: string;
  /** Prefix such as "Attention required" / "All systems nominal", for emphasis. */
  lead: string;
  /** The rest of the sentence after the lead. */
  body: string;
}

export interface VerdictInput {
  host?: HostTelemetry;
  containers?: ContainerItem[];
  disks: DiskMount[];
  problems?: Problem[];
  dockerDf?: DockerSystemDf | null;
  syntheticSources: string[];
}

/** Maximum faults spelled out in the sentence; the rest become "+N more". */
const MAX_NAMED_FAULTS = 3;

const MEDIA_NAME = { nvme: 'NVMe', ssd: 'SSD', hdd: 'HDD' } as const;

function driveClass(d: PhysicalDisk): keyof typeof MEDIA_NAME {
  if (d.protocol === 'nvme' || d.mediaType === 'nvme') return 'nvme';
  if (d.rotational || d.mediaType === 'hdd') return 'hdd';
  return 'ssd';
}

function faultPhrase(p: Problem): string {
  // A bare "74°C" has lost its subject; the detail carries the sensor name.
  if (p.id === 'host:temp') return p.detail.replace(/\.$/, '');
  return p.label;
}

function trimLoad(n: number): string {
  return n.toFixed(2);
}

export function buildVerdict(input: VerdictInput): Verdict {
  const { host, containers, disks, problems, dockerDf, syntheticSources } = input;

  if (!host && !containers) {
    return { level: 'ok', lead: 'Connecting', body: 'waiting for the first telemetry frame…', text: 'Connecting…' };
  }

  // Never call sample data "nominal": that is a claim about a real machine.
  if (syntheticSources.length > 0) {
    const lead = 'Sample data';
    const body = `Guardian could not reach the real ${syntheticSources.join(' / ')} source, so figures shown are placeholders.`;
    return { level: 'sample', lead, body, text: `${lead}: ${body}` };
  }

  const faults = [...(problems ?? [])].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'crit' ? -1 : 1
  );
  const hasCrit = faults.some((p) => p.severity === 'crit');

  const housekeeping: string[] = [];
  if (host?.rebootRequired) housekeeping.push('reboot required');
  if (isPruneWorthwhile(dockerDf)) housekeeping.push(`${formatBytes(dockerDf?.danglingBytes ?? 0)} prune available`);

  if (faults.length > 0) {
    const named = faults.slice(0, MAX_NAMED_FAULTS).map(faultPhrase);
    const extra = faults.length - named.length;
    const parts = [...named];
    if (extra > 0) parts.push(`+${extra} more`);
    parts.push(...housekeeping);
    const lead = hasCrit ? 'Critical' : 'Attention required';
    const body = `${parts.join(', ')}.`;
    return { level: hasCrit ? 'crit' : 'warn', lead, body, text: `${lead}: ${body}` };
  }

  // Healthy: say what "healthy" is made of, so the sentence is checkable.
  const fleet = summarizeFleet(containers ?? []);
  const facts: string[] = [];
  if (containers) {
    facts.push(`${fleet.running} container${fleet.running === 1 ? '' : 's'} running`);
  }
  if (host) {
    const threads = host.cpu.cores.length;
    facts.push(
      `CPU load ${trimLoad(host.cpu.loadAvg[0])}${threads > 0 ? ` on ${threads} core${threads === 1 ? '' : 's'}` : ''}`
    );
  }
  const hot = hottestDrive(host?.physicalDisks);
  const storage = summarizeStorage(disks);
  if (hot && storage) {
    facts.push(`${MEDIA_NAME[driveClass(hot)]} storage at ${hot.tempC}°C with ${formatBytes(storage.freeBytes)} headroom`);
  } else if (storage) {
    facts.push(`${formatBytes(storage.freeBytes)} storage headroom`);
  } else if (hot) {
    facts.push(`${MEDIA_NAME[driveClass(hot)]} storage at ${hot.tempC}°C`);
  }

  const lead = 'All systems nominal';
  const tail = housekeeping.length > 0 ? `Housekeeping: ${housekeeping.join(', ')}.` : 'No action required.';
  const body = `${facts.join(', ')}. ${tail}`;
  return { level: 'ok', lead, body, text: `${lead}: ${body}` };
}
