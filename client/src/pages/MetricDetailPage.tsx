import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Thermometer,
  Fan,
  HardDrive,
  Cpu,
  Battery,
  BatteryCharging,
  BatteryWarning,
  Plug,
  PlugZap,
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  Zap,
} from 'lucide-react';
import { TimeSeriesChart, ChartSeries } from '../components/charts/TimeSeriesChart';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  METRIC_DEFINITIONS,
  HISTORY_RANGES,
  RESOLUTION_LABEL,
  isMetricKey,
  severityForMetric,
} from '../lib/metrics';
import { MetricKey, HistoryRange, HistorySeries, ProcessItem, HostTelemetry, HistoryPoint } from '../types/dashboard';
import { cn, severityTextClass, formatAgo, formatBytes, formatRate, severityFor } from '../lib/utils';

interface MetricDetailPageProps {
  metric: string;
  liveHost?: HostTelemetry;
  liveHistory?: HistoryPoint[];
  onBack: () => void;
}

interface HistoryResponse extends HistorySeries {
  coverage: { oldest: number | null; newest: number | null; totalPoints: number };
}

/** Metrics that are more informative side by side than alone. */
const COMPANION: Partial<Record<MetricKey, MetricKey>> = {
  netRx: 'netTx',
  netTx: 'netRx',
  ram: 'swap',
};

function getLiveMetricValue(metric: MetricKey, host?: HostTelemetry): number | undefined {
  if (!host) return undefined;
  switch (metric) {
    case 'cpu':
      return host.cpu.usagePercent;
    case 'ram':
      return host.memory.usedPercent;
    case 'swap':
      return host.memory.swapTotalBytes > 0 ? host.memory.swapPercent : 0;
    case 'temp': {
      const primaryThermal =
        host.thermals.find((t) => /pkg|package|cpu|tctl|core/i.test(t.label)) || host.thermals[0];
      return primaryThermal ? primaryThermal.tempC : undefined;
    }
    case 'netRx': {
      const primaryNet =
        host.network.find((n) => !/^(docker|veth|br-|virbr|lo|tun|tap|wg|tailscale|zt|ham|nebula|cni|flannel|kube|dummy|ifb|sit|gre)/.test(n.name)) ||
        host.network[0];
      return primaryNet ? primaryNet.rxBytesPerSec : 0;
    }
    case 'netTx': {
      const primaryNet =
        host.network.find((n) => !/^(docker|veth|br-|virbr|lo|tun|tap|wg|tailscale|zt|ham|nebula|cni|flannel|kube|dummy|ifb|sit|gre)/.test(n.name)) ||
        host.network[0];
      return primaryNet ? primaryNet.txBytesPerSec : 0;
    }
    case 'disk': {
      const disks = host.disks || [];
      if (disks.length === 0) return undefined;
      return disks.reduce((worst, d) => (d.usedPercent > worst ? d.usedPercent : worst), 0);
    }
    case 'battery': {
      return host.battery?.present ? host.battery.chargePercent : undefined;
    }
    default:
      return undefined;
  }
}

interface BatteryEvent {
  id: string;
  type: 'charging' | 'discharging' | 'steady';
  startTime: number;
  endTime: number;
  startVal: number;
  endVal: number;
  delta: number;
  durationMs: number;
  ratePerHour: number;
}

function analyzeBatterySessions(points: Array<{ t: number; v: number }>): BatteryEvent[] {
  if (!points || points.length < 2) return [];

  const events: BatteryEvent[] = [];
  let segStart = points[0];
  let segPrev = points[0];
  let currentTrend: 'charging' | 'discharging' | 'steady' = 'steady';

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const diff = pt.v - segPrev.v;

    let pointTrend: 'charging' | 'discharging' | 'steady' = 'steady';
    if (diff > 0.3) pointTrend = 'charging';
    else if (diff < -0.3) pointTrend = 'discharging';
    else pointTrend = currentTrend;

    if (currentTrend === 'steady') {
      currentTrend = pointTrend;
    } else if (pointTrend !== 'steady' && pointTrend !== currentTrend) {
      const durationMs = segPrev.t - segStart.t;
      const delta = segPrev.v - segStart.v;
      if (durationMs >= 60_000 && Math.abs(delta) >= 1) {
        const hours = durationMs / 3_600_000;
        events.push({
          id: `${segStart.t}-${segPrev.t}`,
          type: currentTrend,
          startTime: segStart.t,
          endTime: segPrev.t,
          startVal: segStart.v,
          endVal: segPrev.v,
          delta,
          durationMs,
          ratePerHour: hours > 0 ? delta / hours : 0,
        });
      }
      segStart = segPrev;
      currentTrend = pointTrend;
    }
    segPrev = pt;
  }

  const finalDuration = segPrev.t - segStart.t;
  const finalDelta = segPrev.v - segStart.v;
  if (finalDuration >= 30_000 && (Math.abs(finalDelta) >= 0.5 || currentTrend !== 'steady')) {
    const hours = finalDuration / 3_600_000;
    events.push({
      id: `${segStart.t}-${segPrev.t}`,
      type: currentTrend,
      startTime: segStart.t,
      endTime: segPrev.t,
      startVal: segStart.v,
      endVal: segPrev.v,
      delta: finalDelta,
      durationMs: finalDuration,
      ratePerHour: hours > 0 ? finalDelta / hours : 0,
    });
  }

  return events.reverse();
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return '< 1 min';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="surface p-3">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className={cn('tabular mt-1 text-lg font-semibold leading-none', tone)}>{value}</div>
    </div>
  );
}

export function MetricDetailPage({ metric, liveHost, onBack }: MetricDetailPageProps) {
  const [range, setRange] = useState<HistoryRange>('24h');
  const [primary, setPrimary] = useState<HistoryResponse | null>(null);
  const [companion, setCompanion] = useState<HistoryResponse | null>(null);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const valid = isMetricKey(metric);
  const def = valid ? METRIC_DEFINITIONS[metric as MetricKey] : null;
  const companionKey = valid ? COMPANION[metric as MetricKey] : undefined;
  const companionDef = companionKey ? METRIC_DEFINITIONS[companionKey] : null;

  const liveValue = useMemo(() => {
    if (!valid || !liveHost) return undefined;
    return getLiveMetricValue(metric as MetricKey, liveHost);
  }, [valid, metric, liveHost]);

  const companionLiveValue = useMemo(() => {
    if (!companionKey || !liveHost) return undefined;
    return getLiveMetricValue(companionKey, liveHost);
  }, [companionKey, liveHost]);

  const load = useCallback(async () => {
    if (!valid) return;
    setError(null);
    try {
      const requests = [fetch(`/api/history/${metric}?range=${range}`)];
      if (companionKey) requests.push(fetch(`/api/history/${companionKey}?range=${range}`));
      if (metric === 'cpu' || metric === 'ram' || metric === 'netRx' || metric === 'netTx') {
        const procSort = metric === 'cpu' ? 'cpu' : metric === 'ram' ? 'mem' : 'net';
        requests.push(fetch(`/api/processes?sort=${procSort}&limit=10`));
      }

      const responses = await Promise.all(requests);
      for (const res of responses) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      const jsonResults = await Promise.all(responses.map((r) => r.json()));
      setPrimary(jsonResults[0]);
      let idx = 1;
      if (companionKey) {
        setCompanion(jsonResults[idx++] ?? null);
      }
      if (metric === 'cpu' || metric === 'ram' || metric === 'netRx' || metric === 'netTx') {
        const procData = jsonResults[idx];
        setProcesses(Array.isArray(procData?.processes) ? procData.processes : []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [metric, range, companionKey, valid]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Keep the view live, matched loosely to the resolution being shown.
  useEffect(() => {
    const periodMs = range === '1h' || range === '6h' ? 15_000 : 60_000;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, periodMs);
    return () => window.clearInterval(id);
  }, [load, range]);

  const chartSeries = useMemo<ChartSeries[]>(() => {
    if (!primary || !def) return [];

    let primaryPoints = primary.points;
    if (liveHost?.timestamp && liveValue !== undefined) {
      const lastPoint = primaryPoints[primaryPoints.length - 1];
      if (!lastPoint || liveHost.timestamp > lastPoint.t) {
        primaryPoints = [...primaryPoints, { t: liveHost.timestamp, v: liveValue }];
      } else if (lastPoint && Math.abs(liveHost.timestamp - lastPoint.t) < 10000) {
        primaryPoints = [...primaryPoints.slice(0, -1), { t: liveHost.timestamp, v: liveValue }];
      }
    }

    const list: ChartSeries[] = [
      { id: def.key, label: def.label, points: primaryPoints, color: 'var(--viz-1)' },
    ];

    if (companion && companionDef) {
      let companionPoints = companion.points;
      if (liveHost?.timestamp && companionLiveValue !== undefined) {
        const lastPoint = companionPoints[companionPoints.length - 1];
        if (!lastPoint || liveHost.timestamp > lastPoint.t) {
          companionPoints = [...companionPoints, { t: liveHost.timestamp, v: companionLiveValue }];
        } else if (lastPoint && Math.abs(liveHost.timestamp - lastPoint.t) < 10000) {
          companionPoints = [...companionPoints.slice(0, -1), { t: liveHost.timestamp, v: companionLiveValue }];
        }
      }

      list.push({
        id: companionDef.key,
        label: companionDef.label,
        points: companionPoints,
        color: 'var(--viz-2)',
      });
    }
    return list;
  }, [primary, companion, def, companionDef, liveHost?.timestamp, liveValue, companionLiveValue]);

  const batterySessions = useMemo(() => {
    if (metric !== 'battery' || !primary?.points) return [];
    return analyzeBatterySessions(primary.points);
  }, [metric, primary?.points]);

  if (!valid || !def) {
    return (
      <main className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <p className="mt-6 text-sm text-muted-foreground">Unknown metric “{metric}”.</p>
      </main>
    );
  }

  const stats = primary?.stats ?? null;
  const currentVal = liveValue !== undefined ? liveValue : stats?.latest;
  const severity = currentVal !== undefined ? severityForMetric(def, currentVal) : (stats ? severityForMetric(def, stats.latest) : 'ok');

  /*
   * Y-axis ceiling.
   *
   * The baseline is always zero, so magnitudes are never distorted. The ceiling
   * is where judgement comes in: pinning a percentage chart to 100 wastes most
   * of the plot when a server idles at 20%, but letting it float turns a 2%
   * wobble into a mountain range. So the nominal maximum is kept once the data
   * reaches a meaningful fraction of it, and released only when the series sits
   * far below — where the axis labels still make the true scale obvious.
   */
  const observedMax = Math.max(
    primary?.stats?.max ?? 0,
    companion?.stats?.max ?? 0
  );
  const sharedYMax =
    def.yMax !== undefined && observedMax < def.yMax * 0.75 ? undefined : def.yMax;

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Dashboard
      </Button>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{def.label}</h1>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{def.description}</p>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Time range"
            className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5"
          >
            {HISTORY_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                title={r.title}
                aria-pressed={range === r.id}
                className={cn(
                  'rounded-md px-2.5 py-1 text-2xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  range === r.id
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <Button variant="outline" size="icon-sm" onClick={load} title="Refresh" aria-label="Refresh">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-lg border border-crit/25 bg-crit-soft/60 px-3.5 py-2.5 text-xs"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-crit" aria-hidden="true" />
          Could not load history: {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock
          label="Current"
          value={currentVal !== undefined ? def.format(currentVal) : '—'}
          tone={severityTextClass(severity)}
        />
        <StatBlock label="Average" value={stats ? def.format(stats.avg) : '—'} />
        <StatBlock label="Peak" value={stats ? def.format(stats.max) : '—'} />
        <StatBlock label="Minimum" value={stats ? def.format(stats.min) : '—'} />
      </div>

      <section className="surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">
            {companionDef ? `${def.label} and ${companionDef.label}` : def.label}
          </h2>
          <div className="flex items-center gap-2">
            {primary && (
              <Badge variant="outline">
                {RESOLUTION_LABEL[primary.resolution] ?? primary.resolution}
              </Badge>
            )}
            {stats && <span className="text-2xs text-muted-foreground">{stats.count} points</span>}
          </div>
        </div>

        <TimeSeriesChart
          series={chartSeries}
          height={300}
          formatValue={def.formatAxis}
          yMin={def.yMin}
          yMax={sharedYMax}
          emptyMessage={
            loading ? 'Loading…' : `No samples recorded in the last ${range}. History builds as Guardian runs.`
          }
        />
      </section>

      {/* Live Hardware Thermal Sensors breakdown when viewing Temperature */}
      {metric === 'temp' && (
        <section className="surface mt-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Hardware Thermal Sensors &amp; Cooling
            </h2>
            <span className="text-2xs text-muted-foreground">Live sensor readings</span>
          </div>

          {liveHost?.thermals && liveHost.thermals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border text-2xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 font-medium">Sensor Label</th>
                    <th scope="col" className="py-2 font-medium">Device / Path</th>
                    <th scope="col" className="py-2 text-right font-medium">Temperature</th>
                    <th scope="col" className="py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {liveHost.thermals.map((sensor) => {
                    const tempSev = sensor.isCritical ? 'crit' : severityFor(sensor.tempC, 75, 85);
                    return (
                      <tr key={sensor.name} className="hover:bg-muted/30">
                        <td className="py-2">
                          <span className="font-medium text-foreground flex items-center gap-1.5">
                            <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
                            {sensor.label}
                          </span>
                        </td>
                        <td className="py-2 font-mono text-2xs text-muted-foreground">
                          {sensor.name}
                        </td>
                        <td className="py-2 text-right font-mono">
                          <span className={cn('tabular font-semibold', severityTextClass(tempSev))}>
                            {sensor.tempC.toFixed(1)}°C
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <Badge variant={sensor.isCritical ? 'crit' : tempSev === 'warn' ? 'warn' : 'ok'}>
                            {sensor.isCritical ? 'Critical' : tempSev === 'warn' ? 'Warm' : 'Normal'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Also list GPU temperatures if present */}
                  {liveHost.gpu?.map((gpu) => (
                    <tr key={`gpu-${gpu.id}`} className="hover:bg-muted/30">
                      <td className="py-2">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                          GPU {gpu.name}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-2xs text-muted-foreground">
                        {gpu.driver || 'GPU Driver'}
                      </td>
                      <td className="py-2 text-right font-mono">
                        <span className={cn('tabular font-semibold', gpu.temperatureC ? severityTextClass(severityFor(gpu.temperatureC, 75, 85)) : 'text-muted-foreground')}>
                          {gpu.temperatureC !== undefined ? `${gpu.temperatureC.toFixed(1)}°C` : '—'}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Badge variant="outline">GPU</Badge>
                      </td>
                    </tr>
                  ))}
                  {/* Also list Disk temperatures if present */}
                  {liveHost.disks?.filter((d) => d.tempC !== undefined).map((disk) => (
                    <tr key={`disk-${disk.mountPoint}`} className="hover:bg-muted/30">
                      <td className="py-2">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                          Disk {disk.label || disk.mountPoint}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-2xs text-muted-foreground">
                        {disk.device || disk.mountPoint}
                      </td>
                      <td className="py-2 text-right font-mono">
                        <span className={cn('tabular font-semibold', disk.tempC ? severityTextClass(severityFor(disk.tempC, 50, 60)) : 'text-muted-foreground')}>
                          {disk.tempC !== undefined ? `${disk.tempC.toFixed(1)}°C` : '—'}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Badge variant="outline">Storage</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No hardware thermal sensors detected under /sys/class/hwmon or /sys/class/thermal.</p>
          )}

          {liveHost?.fans && liveHost.fans.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <h3 className="text-2xs font-medium text-muted-foreground mb-2">Cooling Fans</h3>
              <div className="flex flex-wrap gap-4">
                {liveHost.fans.map((fan) => (
                  <div key={fan.name} className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
                    <Fan className={cn('h-3.5 w-3.5 text-muted-foreground', fan.rpm > 0 && 'animate-spin')} />
                    <span className="font-medium text-foreground">{fan.label}</span>
                    <span className="font-mono text-muted-foreground">{fan.rpm} RPM</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Battery & Power Hardware Breakdown and Charge/Discharge Duration Trends */}
      {metric === 'battery' && (
        <div className="mt-4 space-y-4">
          {/* Hardware & Live Power Delivery Status */}
          <section className="surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Battery className="h-4 w-4 text-brand" />
                Power Delivery &amp; Hardware Status
              </h2>
              <span className="text-2xs text-muted-foreground">Live telemetry</span>
            </div>

            {liveHost?.battery?.present ? (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 p-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg',
                        liveHost.battery.onMains
                          ? 'bg-ok/10 text-ok'
                          : 'animate-pulse bg-crit/10 text-crit'
                      )}
                    >
                      {liveHost.battery.onMains ? (
                        <Plug className="h-5 w-5" />
                      ) : (
                        <PlugZap className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {liveHost.battery.onMains ? 'AC Mains Connected' : 'Running on Battery Power'}
                        </span>
                        <Badge variant={liveHost.battery.onMains ? 'ok' : 'crit'}>
                          {liveHost.battery.status || (liveHost.battery.onMains ? 'Mains' : 'Discharging')}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {liveHost.battery.onMains
                          ? liveHost.battery.chargePercent !== undefined && liveHost.battery.chargePercent >= 99
                            ? 'Battery is fully charged. Running on steady wall power.'
                            : 'Host is connected to wall power.'
                          : liveHost.battery.minutesRemaining !== undefined
                            ? `Wall power lost or disconnected. ~${liveHost.battery.minutesRemaining} minutes of reserve remaining.`
                            : 'Wall power lost or disconnected. Running on internal battery reserve.'}
                      </p>
                    </div>
                  </div>

                  {liveHost.battery.chargePercent !== undefined && (
                    <div className="text-right">
                      <div className="tabular text-2xl font-bold tracking-tight text-foreground">
                        {liveHost.battery.chargePercent}%
                      </div>
                      <div className="text-2xs text-muted-foreground">Charge Remaining</div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <StatBlock
                    label="State"
                    value={liveHost.battery.status || (liveHost.battery.onMains ? 'Mains' : 'Discharging')}
                  />
                  <StatBlock
                    label="Power Draw"
                    value={liveHost.battery.powerWatts !== undefined ? `${liveHost.battery.powerWatts.toFixed(1)} W` : '—'}
                  />
                  <StatBlock
                    label="Voltage"
                    value={liveHost.battery.voltageVolts !== undefined ? `${liveHost.battery.voltageVolts.toFixed(2)} V` : '—'}
                  />
                  <StatBlock
                    label="Runtime Left"
                    value={
                      liveHost.battery.minutesRemaining !== undefined
                        ? `${Math.floor(liveHost.battery.minutesRemaining / 60)}h ${liveHost.battery.minutesRemaining % 60}m`
                        : '—'
                    }
                    tone={!liveHost.battery.onMains ? 'text-crit' : undefined}
                  />
                  <StatBlock
                    label="Cycles"
                    value={
                      liveHost.battery.cycleCount !== undefined && liveHost.battery.cycleCount > 0
                        ? `${liveHost.battery.cycleCount}`
                        : '—'
                    }
                  />
                  <StatBlock
                    label="Chemistry"
                    value={liveHost.battery.technology || 'Li-ion'}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
                No physical battery or UPS was detected on this system (/sys/class/power_supply). Desktop and rackmount servers without a dedicated power reserve do not log battery telemetry.
              </div>
            )}
          </section>

          {/* Charge / Discharge Trends & Duration History */}
          <section className="surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Zap className="h-4 w-4 text-brand" />
                  Charge &amp; Discharge Trend Analysis
                </h2>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  Detected power cycle durations and charge/discharge velocity over the selected {range} window.
                </p>
              </div>
              {batterySessions.length > 0 && (
                <Badge variant="outline">
                  {batterySessions.length} session{batterySessions.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>

            {batterySessions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border text-2xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 font-medium">Activity</th>
                      <th scope="col" className="py-2 font-medium">Time Window</th>
                      <th scope="col" className="py-2 text-right font-medium">Duration</th>
                      <th scope="col" className="py-2 text-right font-medium">Level Range</th>
                      <th scope="col" className="py-2 text-right font-medium">Net Delta</th>
                      <th scope="col" className="py-2 text-right font-medium">Rate (%/hr)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {batterySessions.map((session) => {
                      const isCharging = session.type === 'charging';
                      const isDischarging = session.type === 'discharging';
                      return (
                        <tr key={session.id} className="hover:bg-muted/30">
                          <td className="py-2.5">
                            <span className="flex items-center gap-1.5 font-medium">
                              {isCharging ? (
                                <>
                                  <ArrowUpRight className="h-4 w-4 text-ok" />
                                  <span className="text-ok">Charging</span>
                                </>
                              ) : isDischarging ? (
                                <>
                                  <ArrowDownRight className="h-4 w-4 text-warn" />
                                  <span className="text-warn">Discharging</span>
                                </>
                              ) : (
                                <>
                                  <Clock className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-muted-foreground">Steady</span>
                                </>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-2xs text-muted-foreground">
                            {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' – '}
                            {new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2.5 text-right font-medium text-foreground">
                            {formatDuration(session.durationMs)}
                          </td>
                          <td className="py-2.5 text-right font-mono text-muted-foreground">
                            {session.startVal.toFixed(0)}% → {session.endVal.toFixed(0)}%
                          </td>
                          <td className="py-2.5 text-right font-mono">
                            <span
                              className={cn(
                                'tabular font-semibold',
                                isCharging ? 'text-ok' : isDischarging ? 'text-warn' : 'text-foreground'
                              )}
                            >
                              {session.delta > 0 ? `+${session.delta.toFixed(1)}%` : `${session.delta.toFixed(1)}%`}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-mono text-muted-foreground">
                            {session.ratePerHour !== 0
                              ? `${session.ratePerHour > 0 ? '+' : ''}${session.ratePerHour.toFixed(1)}%/h`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No distinct charge or discharge cycles detected in the last {range}. As the host alternates between battery and mains power, durations and time-series trends will appear here.
              </div>
            )}
          </section>
        </div>
      )}

      {/* Top Consuming Processes breakdown for CPU, RAM, and Network */}
      {(metric === 'cpu' || metric === 'ram' || metric === 'netRx' || metric === 'netTx') && processes.length > 0 && (
        <section className="surface mt-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Top Processes consuming{' '}
              {metric === 'cpu'
                ? 'CPU'
                : metric === 'ram'
                ? 'Memory'
                : 'Network Bandwidth'}
            </h2>
            <span className="text-2xs text-muted-foreground">Live top {processes.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-2xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">PID</th>
                  <th scope="col" className="py-2 font-medium">Process / Command</th>
                  <th scope="col" className="py-2 font-medium">User</th>
                  <th scope="col" className="py-2 text-right font-medium">CPU</th>
                  <th scope="col" className="py-2 text-right font-medium">RAM</th>
                  <th scope="col" className="py-2 text-right font-medium">Network (Down / Up)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {processes.map((proc) => {
                  const highCpu = proc.cpuPercent >= 50;
                  const medCpu = proc.cpuPercent >= 15;
                  const highMem = proc.memPercent >= 30;
                  const rx = proc.netRxBytesPerSec || 0;
                  const tx = proc.netTxBytesPerSec || 0;
                  const activeNet = rx > 1024 || tx > 1024;
                  const highNet = rx > 5 * 1024 * 1024 || tx > 5 * 1024 * 1024;

                  return (
                    <tr key={proc.pid} className="hover:bg-muted/30">
                      <td className="py-2 font-mono text-2xs text-muted-foreground">{proc.pid}</td>
                      <td className="max-w-[16rem] truncate py-2 sm:max-w-md">
                        <span className="font-medium text-foreground">{proc.name}</span>
                        <p className="truncate font-mono text-2xs text-muted-foreground" title={proc.cmd}>
                          {proc.cmd}
                        </p>
                      </td>
                      <td className="py-2 font-mono text-2xs text-muted-foreground">{proc.user}</td>
                      <td className="py-2 text-right font-mono">
                        <span className={cn('tabular font-medium', highCpu ? 'text-crit' : medCpu ? 'text-warn' : 'text-foreground')}>
                          {proc.cpuPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono">
                        <span className={cn('tabular font-medium', highMem ? 'text-warn' : 'text-foreground')}>
                          {formatBytes(proc.memBytes, 0)}
                        </span>
                        <span className="ml-1 text-2xs text-muted-foreground">({proc.memPercent.toFixed(0)}%)</span>
                      </td>
                      <td className="py-2 text-right font-mono">
                        {activeNet ? (
                          <div className="flex flex-col items-end">
                            <span className={cn('tabular flex items-center gap-0.5 text-2xs font-medium', highNet ? 'text-brand font-semibold' : 'text-foreground')}>
                              <ArrowDown className="h-2.5 w-2.5 text-brand" />
                              {formatRate(rx)}
                            </span>
                            {tx > 1024 && (
                              <span className="tabular flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <ArrowUp className="h-2.5 w-2.5" />
                                {formatRate(tx)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-2xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* A table view keeps the data reachable without relying on colour. */}
      {primary && primary.points.length > 0 && (
        <details className="surface mt-4 p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            View as table
          </summary>
          <div className="mt-3 max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-card text-2xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1.5 font-medium">Time</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{def.label}</th>
                  {companionDef && (
                    <th scope="col" className="py-1.5 text-right font-medium">
                      {companionDef.label}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...primary.points]
                  .reverse()
                  .slice(0, 200)
                  .map((p, i) => {
                    const other = companion?.points.find((c) => c.t === p.t);
                    return (
                      <tr key={`${p.t}-${i}`}>
                        <td className="py-1.5 font-mono text-muted-foreground">
                          {new Date(p.t).toLocaleString()}
                        </td>
                        <td className="tabular py-1.5 text-right text-foreground">
                          {def.format(p.v)}
                        </td>
                        {companionDef && (
                          <td className="tabular py-1.5 text-right text-foreground">
                            {other ? companionDef.format(other.v) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {primary?.coverage?.oldest && (
        <p className="mt-3 text-2xs text-muted-foreground">
          History spans {formatAgo(primary.coverage.oldest).replace(' ago', '')} ·{' '}
          {primary.coverage.totalPoints.toLocaleString()} stored points · retained for 30 days.
        </p>
      )}
    </main>
  );
}
