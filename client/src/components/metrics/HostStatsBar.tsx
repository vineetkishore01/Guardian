import React from 'react';
import { ArrowDown, ArrowUp, Thermometer, Fan } from 'lucide-react';
import { MetricCard, MetricCardSkeleton } from './MetricCard';
import { CoreStrip } from './CoreStrip';
import { GpuCard } from './GpuCard';
import { HostTelemetry, HistoryPoint, MetricKey } from '../../types/dashboard';
import { formatBytes, formatRate, severityFor, severityTextClass, cn } from '../../lib/utils';

interface HostStatsBarProps {
  host?: HostTelemetry;
  history?: HistoryPoint[];
  /** Opens the long-term history view for a metric. */
  onOpenMetric?: (metric: MetricKey) => void;
}

/*
 * Interfaces that are never the machine's primary link.
 */
const VIRTUAL_IFACE =
  /^(docker|veth|br-|virbr|lo|tun|tap|wg|tailscale|zt|ham|nebula|cni|flannel|kube|dummy|ifb|sit|gre)/;

function pickPrimaryInterface(host: HostTelemetry) {
  const physical = host.network.filter((n) => !VIRTUAL_IFACE.test(n.name));
  if (physical.length === 0) return host.network[0];
  // Busiest physical link by lifetime traffic, rather than assuming "eno1".
  return physical.reduce((best, n) =>
    n.rxTotalBytes + n.txTotalBytes > best.rxTotalBytes + best.txTotalBytes ? n : best
  );
}

function pickPrimaryThermal(host: HostTelemetry) {
  return (
    host.thermals.find((t) => /pkg|package|cpu|tctl|core/i.test(t.label)) ?? host.thermals[0] ?? null
  );
}

export function HostStatsBar({ host, history = [], onOpenMetric }: HostStatsBarProps) {
  const open = (metric: MetricKey) => (onOpenMetric ? () => onOpenMetric(metric) : undefined);

  if (!host) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const cpuUsage = host.cpu.usagePercent || 0;
  const memUsed = host.memory.usedPercent || 0;
  const threadCount = host.cpu.cores.length;

  const thermal = pickPrimaryThermal(host);
  const primaryNet = pickPrimaryInterface(host);

  const cpuSeverity = severityFor(cpuUsage, 75, 90);
  const memSeverity = severityFor(memUsed, 80, 92);
  const tempSeverity = thermal ? severityFor(thermal.tempC, 75, 85) : 'ok';

  const swapPercent = host.memory.swapPercent || 0;

  // Load relative to thread count: 2.35 means nothing until you know it is
  // spread across 8 threads.
  const loadPercent = threadCount > 0 ? (host.cpu.loadAvg[0] / threadCount) * 100 : 0;
  const ioSeverity = severityFor(host.cpu.iowaitPercent || 0, 10, 25);

  const primaryFan = host.fans && host.fans.length > 0 ? host.fans[0] : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="CPU"
          onOpen={open('cpu')}
          value={cpuUsage.toFixed(1)}
          unit="%"
          severity={cpuSeverity}
          trend={history.map((h) => h.cpu)}
          trendMin={0}
          trendMax={100}
          meta={
            <div className="flex items-center gap-1.5">
              {host.packageTempC !== undefined && (
                <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-medium bg-muted text-muted-foreground">
                  <Thermometer className="h-2.5 w-2.5" />
                  {host.packageTempC}°C
                </span>
              )}
              {threadCount > 0 && <span>{threadCount} threads</span>}
            </div>
          }
          belowValue={<CoreStrip cores={host.cpu.cores} className="mt-3" />}
          footer={
            <>
              <span className="font-mono" title="1 / 5 / 15 minute load average, as a share of total threads">
                load {loadPercent.toFixed(0)}%
                <span className="text-muted-foreground/70">
                  {' '}({host.cpu.loadAvg.map((n) => n.toFixed(2)).join(' ')})
                </span>
              </span>
              {host.cpu.iowaitPercent > 0 ? (
                <span
                  className={cn('font-mono', ioSeverity !== 'ok' && severityTextClass(ioSeverity))}
                  title="Time blocked waiting on disk. High iowait with low CPU means the disks are the bottleneck."
                >
                  iowait {host.cpu.iowaitPercent.toFixed(1)}%
                </span>
              ) : (
                <span className="truncate" title={host.cpu.model}>
                  {host.cpu.model.replace(/\(R\)|\(TM\)|CPU|Processor/g, '').trim()}
                </span>
              )}
            </>
          }
        />

        <MetricCard
          label="Memory"
          onOpen={open('ram')}
          value={memUsed.toFixed(1)}
          unit="%"
          severity={memSeverity}
          percent={memUsed}
          trend={history.map((h) => h.ram)}
          trendMin={0}
          trendMax={100}
          meta={`${formatBytes(host.memory.availableBytes)} available`}
          footer={
            <>
              <span className="font-mono">
                {formatBytes(host.memory.usedBytes)} / {formatBytes(host.memory.totalBytes)}
              </span>
              {host.memory.swapTotalBytes > 0 ? (
                <span className="font-mono">
                  swap {formatBytes(host.memory.swapUsedBytes)} ({swapPercent.toFixed(0)}%)
                </span>
              ) : (
                <span>no swap</span>
              )}
            </>
          }
        />

        <MetricCard
          label="Temperature"
          onOpen={thermal ? open('temp') : undefined}
          value={thermal ? thermal.tempC.toFixed(1) : '—'}
          unit={thermal ? '°C' : undefined}
          severity={tempSeverity}
          percent={thermal ? Math.min(100, thermal.tempC) : undefined}
          trend={thermal ? history.map((h) => h.temp) : undefined}
          trendMin={20}
          trendMax={100}
          meta={thermal?.label}
          footer={
            primaryFan ? (
              <span className="flex items-center gap-1 font-mono text-2xs">
                <Fan className={cn('h-3 w-3 text-muted-foreground', primaryFan.rpm > 0 && 'animate-spin')} />
                {primaryFan.label}: {primaryFan.rpm} RPM
              </span>
            ) : host.thermals.length > 1 ? (
              <span className="truncate font-mono">
                {host.thermals
                  .filter((t) => t.name !== thermal?.name)
                  .slice(0, 2)
                  .map((t) => `${t.label.slice(0, 12)} ${t.tempC.toFixed(0)}°`)
                  .join('   ')}
              </span>
            ) : (
              <span>{host.thermals.length === 0 ? 'no sensors detected' : 'single sensor'}</span>
            )
          }
        />

        <MetricCard
          label="Network"
          onOpen={primaryNet ? open('netRx') : undefined}
          value={primaryNet ? formatRate(primaryNet.rxBytesPerSec).split(' ')[0] : '—'}
          unit={primaryNet ? formatRate(primaryNet.rxBytesPerSec).split(' ')[1] : undefined}
          meta={primaryNet ? <span className="font-mono">{primaryNet.name}</span> : 'no interface'}
          trend={primaryNet ? history.map((h) => h.netRx) : undefined}
          footer={
            primaryNet ? (
              <>
                <span className="flex items-center gap-1 font-mono">
                  <ArrowDown className="h-3 w-3 text-ok" aria-hidden="true" />
                  {formatRate(primaryNet.rxBytesPerSec)}
                </span>
                <span className="flex items-center gap-1 font-mono">
                  <ArrowUp className="h-3 w-3 text-brand" aria-hidden="true" />
                  {formatRate(primaryNet.txBytesPerSec)}
                </span>
              </>
            ) : (
              <span>no network interfaces detected</span>
            )
          }
        />
      </div>

      {/* GPU Cards (if present) */}
      {host.gpu && host.gpu.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {host.gpu.map((gpu) => (
            <GpuCard key={gpu.id} gpu={gpu} />
          ))}
        </div>
      )}
    </div>
  );
}
