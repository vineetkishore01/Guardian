import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { MetricCard, MetricCardSkeleton } from './MetricCard';
import { HostTelemetry, HistoryPoint, MetricKey } from '../../types/dashboard';
import { formatBytes, formatRate, severityFor } from '../../lib/utils';

interface HostStatsBarProps {
  host?: HostTelemetry;
  history?: HistoryPoint[];
  /** Opens the long-term history view for a metric. */
  onOpenMetric?: (metric: MetricKey) => void;
}

/** Interfaces that are never the machine's primary link. */
const VIRTUAL_IFACE = /^(docker|veth|br-|virbr|lo|tun|tap|wg)/;

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

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="CPU"
        onOpen={open('cpu')}
        value={cpuUsage.toFixed(1)}
        unit="%"
        severity={cpuSeverity}
        percent={cpuUsage}
        trend={history.map((h) => h.cpu)}
        trendMin={0}
        trendMax={100}
        meta={threadCount > 0 ? `${threadCount} threads` : undefined}
        footer={
          <>
            <span className="font-mono">
              load {host.cpu.loadAvg.map((n) => n.toFixed(2)).join('  ')}
            </span>
            <span className="truncate" title={host.cpu.model}>
              {host.cpu.model.replace(/\(R\)|\(TM\)|CPU|Processor/g, '').trim()}
            </span>
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
        // Without a sensor the history is all zeroes; drawing a flat line there
        // would imply a measurement that was never taken.
        trend={thermal ? history.map((h) => h.temp) : undefined}
        trendMin={20}
        trendMax={100}
        meta={thermal?.label}
        footer={
          host.thermals.length > 1 ? (
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
        // A dash, not a confident "0 B/s", when there is no interface to read.
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
  );
}
