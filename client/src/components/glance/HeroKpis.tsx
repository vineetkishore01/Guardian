import React from 'react';
import { LiveSparkline } from '../charts/LiveSparkline';
import { Readout, splitUnit } from '../ui/Readout';
import {
  ContainerItem,
  DiskMount,
  HistoryPoint,
  HostTelemetry,
  MetricKey,
} from '../../types/dashboard';
import {
  breakdownMemory,
  loadSeverity,
  packageTemp,
  summarizeFleet,
  summarizeStorage,
} from '../../lib/glance';
import {
  cn,
  formatBytes,
  Severity,
  severityDotClass,
  severityFor,
  severityTextClass,
} from '../../lib/utils';

interface HeroKpisProps {
  host?: HostTelemetry;
  history?: HistoryPoint[];
  containers?: ContainerItem[];
  disks: DiskMount[];
  onOpenMetric: (metric: MetricKey) => void;
  onOpenFleet: () => void;
}

const WORST: Record<Severity, number> = { ok: 0, warn: 1, crit: 2 };
const worstOf = (...s: Severity[]): Severity => s.reduce((a, b) => (WORST[b] > WORST[a] ? b : a), 'ok');

/** Shared frame: label + state dot, one hero number, then quiet detail rows. */
function Kpi({
  label,
  severity,
  onOpen,
  openLabel,
  children,
}: {
  label: string;
  severity: Severity;
  onOpen?: () => void;
  openLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? openLabel : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'surface flex flex-col gap-2.5 p-4',
        onOpen && 'cursor-pointer hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        severity === 'crit' && 'border-crit/40',
        severity === 'warn' && 'border-warn/35'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="tile-label">{label}</span>
        <span
          className={cn('h-1.5 w-1.5 rounded-full', severityDotClass(severity))}
          role="img"
          aria-label={severity === 'ok' ? 'nominal' : severity === 'warn' ? 'warning' : 'critical'}
        />
      </div>
      {children}
    </div>
  );
}

/** A labelled secondary line: muted key, mono value. */
function Row({
  k,
  children,
  title,
}: {
  k: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-2xs" title={title}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-right font-mono tabular-nums">{children}</span>
    </div>
  );
}

function Hero({
  value,
  unit,
  severity,
  aside,
}: {
  value: React.ReactNode;
  unit?: string;
  severity: Severity;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <span className="flex items-baseline gap-1">
        <Readout
          value={value}
          className={cn('text-3xl font-semibold leading-none tracking-tight', severityTextClass(severity))}
        />
        {unit && <span className="font-mono text-sm text-muted-foreground">{unit}</span>}
      </span>
      {aside}
    </div>
  );
}

function SkeletonKpi() {
  return (
    <div className="surface flex flex-col gap-3 p-4">
      <div className="skeleton h-2.5 w-16" />
      <div className="skeleton h-7 w-24" />
      <div className="skeleton h-2.5 w-full" />
      <div className="skeleton h-2.5 w-2/3" />
    </div>
  );
}

export function HeroKpis({ host, history = [], containers, disks, onOpenMetric, onOpenFleet }: HeroKpisProps) {
  if (!host) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonKpi key={i} />
        ))}
      </div>
    );
  }

  /* ------------------------------ compute ------------------------------ */
  const threads = host.cpu.cores.length;
  const cpu = host.cpu.usagePercent || 0;
  const cpuSev = severityFor(cpu, 75, 90);
  const [l1, l5, l15] = host.cpu.loadAvg;
  const loadSev = loadSeverity(l1, threads);
  const temp = packageTemp(host);
  const tempSev = temp !== undefined ? severityFor(temp, 75, 85) : 'ok';
  const iowait = host.cpu.iowaitPercent || 0;
  const ioSev = severityFor(iowait, 10, 25);
  const computeSev = worstOf(cpuSev, loadSev, tempSev, ioSev);

  /* ------------------------------ memory ------------------------------- */
  const mem = host.memory;
  const memPct = mem.usedPercent || 0;
  const memSev = severityFor(memPct, 80, 92);
  const swapSev = severityFor(mem.swapPercent || 0, 40, 70);
  const memoryOverall = worstOf(memSev, swapSev);
  const split = breakdownMemory(mem);
  const pctOf = (b: number) => `${Math.max(0, (b / split.totalBytes) * 100)}%`;

  /* ------------------------------ storage ------------------------------ */
  const storage = summarizeStorage(disks);
  const storageSev = storage
    ? worstOf(severityFor(storage.usedPercent, 80, 90), severityFor(storage.tightest.usedPercent, 85, 95))
    : 'ok';

  /* ------------------------------- fleet ------------------------------- */
  const fleet = summarizeFleet(containers ?? []);
  const fleetSev: Severity = fleet.unhealthy > 0 || fleet.restarting > 0 ? 'crit' : fleet.flagged > 0 ? 'warn' : 'ok';

  const cpuTrend = history.map((h) => h.cpu);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* a) Compute */}
      <Kpi label="Compute" severity={computeSev} onOpen={() => onOpenMetric('cpu')} openLabel="Open CPU history">
        <Hero
          value={cpu.toFixed(1)}
          unit="%"
          severity={cpuSev}
          aside={
            cpuTrend.length > 1 ? (
              <LiveSparkline data={cpuTrend} min={0} max={100} width={80} height={26} color="hsl(var(--muted-foreground))" />
            ) : undefined
          }
        />
        <div className="space-y-1">
          <Row
            k={`load 1/5/15m · ${threads} ${threads === 1 ? 'core' : 'cores'}`}
            title="Load average against thread count. At 1.0 per thread every core is busy on average."
          >
            <span className={severityTextClass(loadSev)}>
              {l1.toFixed(2)} <span className="text-muted-foreground">/</span> {l5.toFixed(2)}{' '}
              <span className="text-muted-foreground">/</span> {l15.toFixed(2)}
            </span>
          </Row>
          {temp !== undefined && (
            <Row k="package temp">
              <span className={severityTextClass(tempSev)}>
                {temp.toFixed(0)}
                <span className="ml-0.5 text-[0.8em] text-muted-foreground">°C</span>
              </span>
            </Row>
          )}
          {iowait > 0 && (
            <Row
              k="iowait"
              title="Time blocked waiting on disk. High iowait with low CPU means storage is the bottleneck."
            >
              <span className={ioSev === 'ok' ? 'text-io' : severityTextClass(ioSev)}>
                {iowait.toFixed(1)}
                <span className="ml-0.5 text-[0.8em] text-muted-foreground">%</span>
              </span>
            </Row>
          )}
        </div>
      </Kpi>

      {/* b) Memory architecture */}
      <Kpi label="Memory" severity={memoryOverall} onOpen={() => onOpenMetric('ram')} openLabel="Open memory history">
        <Hero
          value={memPct.toFixed(1)}
          unit="%"
          severity={memSev}
          aside={
            <span className="pb-0.5 font-mono text-2xs tabular-nums text-muted-foreground">
              {formatBytes(mem.availableBytes)} avail
            </span>
          }
        />

        {/* app | cache | other | free. Neutral ramp: colour is for state, and
            only the app segment takes it, since that is the part that can run out. */}
        <div
          className="flex h-2 w-full overflow-hidden rounded-sm bg-muted"
          role="img"
          aria-label={`Application ${formatBytes(split.appBytes)}, cache ${formatBytes(split.cacheBytes)}, free ${formatBytes(split.freeBytes)}`}
        >
          <div
            className={cn(memSev === 'crit' ? 'bg-crit' : memSev === 'warn' ? 'bg-warn' : 'bg-foreground/70')}
            style={{ width: pctOf(split.appBytes) }}
            title={
              split.detailed
                ? `Application memory ${formatBytes(split.appBytes)} (active ${formatBytes(mem.activeAnonBytes ?? 0)}, inactive ${formatBytes(mem.inactiveAnonBytes ?? 0)})`
                : `In use ${formatBytes(split.appBytes)}`
            }
          />
          {split.detailed && (
            <div
              className="bg-foreground/30"
              style={{ width: pctOf(split.cacheBytes) }}
              title={`Page cache + buffers ${formatBytes(split.cacheBytes)}. The kernel hands this back on demand.`}
            />
          )}
          <div className="bg-foreground/10" style={{ width: pctOf(split.otherBytes) }} title={`Kernel / other ${formatBytes(split.otherBytes)}`} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between font-mono text-2xs tabular-nums">
            <span className="flex items-center gap-1">
              <i className="inline-block h-1.5 w-1.5 rounded-[1px] bg-foreground/70" aria-hidden="true" />
              <span className="text-muted-foreground">app</span> {splitUnit(formatBytes(split.appBytes)).value}
              <span className="text-[0.8em] text-muted-foreground">{splitUnit(formatBytes(split.appBytes)).unit}</span>
            </span>
            {split.detailed && (
              <span className="flex items-center gap-1">
                <i className="inline-block h-1.5 w-1.5 rounded-[1px] bg-foreground/30" aria-hidden="true" />
                <span className="text-muted-foreground">cache</span> {splitUnit(formatBytes(split.cacheBytes)).value}
                <span className="text-[0.8em] text-muted-foreground">{splitUnit(formatBytes(split.cacheBytes)).unit}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <i className="inline-block h-1.5 w-1.5 rounded-[1px] bg-muted-foreground/30" aria-hidden="true" />
              <span className="text-muted-foreground">free</span> {splitUnit(formatBytes(split.freeBytes)).value}
              <span className="text-[0.8em] text-muted-foreground">{splitUnit(formatBytes(split.freeBytes)).unit}</span>
            </span>
          </div>
          <Row
            k="swap"
            title={
              mem.swapInBytesPerSec !== undefined
                ? 'Swap occupancy. Sustained paging in both directions is thrashing.'
                : 'Swap occupancy.'
            }
          >
            {mem.swapTotalBytes > 0 ? (
              <span className={severityTextClass(swapSev)}>
                {formatBytes(mem.swapUsedBytes)}
                <span className="text-muted-foreground"> / {formatBytes(mem.swapTotalBytes)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </Row>
        </div>
      </Kpi>

      {/* c) Storage headroom */}
      <Kpi label="Storage" severity={storageSev} onOpen={() => onOpenMetric('disk')} openLabel="Open storage history">
        {storage ? (
          <>
            <Hero
              value={storage.usedPercent.toFixed(1)}
              unit="% used"
              severity={severityFor(storage.usedPercent, 80, 90)}
              aside={
                <span className="pb-0.5 font-mono text-2xs tabular-nums text-muted-foreground">
                  {splitUnit(formatBytes(storage.freeBytes)).value}{' '}
                  <span className="text-[0.8em]">{splitUnit(formatBytes(storage.freeBytes)).unit}</span> free
                </span>
              }
            />
            <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
              <div
                className={cn(
                  'h-full',
                  storageSev === 'crit' ? 'bg-crit' : storageSev === 'warn' ? 'bg-warn' : 'bg-foreground/70'
                )}
                style={{ width: `${Math.min(100, storage.usedPercent)}%` }}
              />
            </div>
            <div className="space-y-1">
              <Row k="tightest" title={`${storage.tightest.mountPoint} on ${storage.tightest.device}`}>
                <span className="text-muted-foreground">{storage.tightest.mountPoint}</span>{' '}
                <span className={severityTextClass(severityFor(storage.tightest.usedPercent, 85, 95))}>
                  {storage.tightest.usedPercent.toFixed(0)}
                  <span className="ml-0.5 text-[0.8em] text-muted-foreground">%</span>
                </span>
              </Row>
              <Row k={`${storage.volumeCount} ${storage.volumeCount === 1 ? 'volume' : 'volumes'}`}>
                <span className="text-muted-foreground">
                  {formatBytes(storage.usedBytes)} of {formatBytes(storage.totalBytes)}
                </span>
              </Row>
            </div>
          </>
        ) : (
          <p className="py-3 text-2xs text-muted-foreground">No mounted volumes reported.</p>
        )}
      </Kpi>

      {/* d) Container fleet */}
      <Kpi label="Container fleet" severity={fleetSev} onOpen={onOpenFleet} openLabel="Jump to container fleet">
        <Hero
          value={
            <>
              {fleet.running}
              <span className="text-xl text-muted-foreground">/{fleet.total}</span>
            </>
          }
          unit="running"
          severity="ok"
        />
        <div className="flex h-2 w-full gap-px overflow-hidden rounded-sm" role="presentation">
          {/* One tick per container: healthy, flagged, stopped. Fleet shape at a glance. */}
          {fleet.total > 0 &&
            [...(containers ?? [])]
              .filter((c) => !c.hidden)
              .sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running'))
              .map((c) => (
                <span
                  key={c.id}
                  className={cn(
                    'h-full min-w-[2px] flex-1',
                    c.health === 'unhealthy' || c.state === 'restarting' || c.state === 'dead'
                      ? 'bg-crit'
                      : c.state === 'running'
                      ? 'bg-ok/70'
                      : 'bg-muted-foreground/25'
                  )}
                  title={`${c.displayName || c.name}: ${c.state}`}
                />
              ))}
        </div>
        <div className="space-y-1">
          <Row k="unhealthy">
            <span className={fleet.unhealthy > 0 ? 'text-crit' : 'text-muted-foreground'}>{fleet.unhealthy}</span>
          </Row>
          <Row k="restarting">
            <span className={fleet.restarting > 0 ? 'text-crit' : 'text-muted-foreground'}>{fleet.restarting}</span>
          </Row>
          {fleet.stopped > 0 && (
            <Row k="stopped">
              <span className="text-muted-foreground">{fleet.stopped}</span>
            </Row>
          )}
        </div>
      </Kpi>
    </div>
  );
}
