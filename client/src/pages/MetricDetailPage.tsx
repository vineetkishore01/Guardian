import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react';
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
import { MetricKey, HistoryRange, HistorySeries, ProcessItem } from '../types/dashboard';
import { cn, severityTextClass, formatAgo, formatBytes } from '../lib/utils';

interface MetricDetailPageProps {
  metric: string;
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

export function MetricDetailPage({ metric, onBack }: MetricDetailPageProps) {
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

  const load = useCallback(async () => {
    if (!valid) return;
    setError(null);
    try {
      const requests = [fetch(`/api/history/${metric}?range=${range}`)];
      if (companionKey) requests.push(fetch(`/api/history/${companionKey}?range=${range}`));
      if (metric === 'cpu' || metric === 'ram') {
        const procSort = metric === 'cpu' ? 'cpu' : 'mem';
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
      if (metric === 'cpu' || metric === 'ram') {
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
    const periodMs = range === '1h' || range === '6h' ? 30_000 : 120_000;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, periodMs);
    return () => window.clearInterval(id);
  }, [load, range]);

  const chartSeries = useMemo<ChartSeries[]>(() => {
    if (!primary || !def) return [];
    const list: ChartSeries[] = [
      { id: def.key, label: def.label, points: primary.points, color: 'var(--viz-1)' },
    ];
    if (companion && companionDef) {
      list.push({
        id: companionDef.key,
        label: companionDef.label,
        points: companion.points,
        color: 'var(--viz-2)',
      });
    }
    return list;
  }, [primary, companion, def, companionDef]);

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
  const severity = stats ? severityForMetric(def, stats.latest) : 'ok';

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
          value={stats ? def.format(stats.latest) : '—'}
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

      {/* Top Consuming Processes breakdown for CPU and RAM */}
      {(metric === 'cpu' || metric === 'ram') && processes.length > 0 && (
        <section className="surface mt-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Top Processes consuming {metric === 'cpu' ? 'CPU' : 'Memory'}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {processes.map((proc) => {
                  const highCpu = proc.cpuPercent >= 50;
                  const medCpu = proc.cpuPercent >= 15;
                  const highMem = proc.memPercent >= 30;

                  return (
                    <tr key={proc.pid} className="hover:bg-muted/30">
                      <td className="py-2 font-mono text-2xs text-muted-foreground">{proc.pid}</td>
                      <td className="max-w-[20rem] truncate py-2 sm:max-w-md">
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
