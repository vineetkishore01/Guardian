import React, { useState, useEffect } from 'react';
import { Clock, Calendar, ShieldCheck, CheckCircle2, RefreshCw, Cpu, Activity } from 'lucide-react';
import { HostTelemetry } from '../../types/dashboard';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';

interface UptimeCardProps {
  host?: HostTelemetry;
  className?: string;
}

export function UptimeCard({ host, className }: UptimeCardProps) {
  // Base seconds from live telemetry, incremented locally every second for a live clock feel
  const initialSeconds = host?.uptimeSeconds || (host?.uptimeInfo?.seconds ?? 0);
  const [liveSeconds, setLiveSeconds] = useState(initialSeconds);

  useEffect(() => {
    setLiveSeconds(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (!host) return;
    const interval = setInterval(() => {
      setLiveSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [host]);

  if (!host) return null;

  const days = Math.floor(liveSeconds / 86400);
  const hours = Math.floor((liveSeconds % 86400) / 3600);
  const minutes = Math.floor((liveSeconds % 3600) / 60);
  const seconds = Math.floor(liveSeconds % 60);

  const uptimeInfo = host.uptimeInfo;
  const bootMs = uptimeInfo?.bootTime ?? (Date.now() - liveSeconds * 1000);
  const bootDate = new Date(bootMs);
  const bootFormatted =
    uptimeInfo?.bootFormatted ||
    bootDate.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

  const isFreshBoot = liveSeconds < 86400;
  const isHighUptime = liveSeconds >= 86400 * 30;

  const statusVariant = isFreshBoot ? 'warn' : 'ok';
  const statusText = isFreshBoot
    ? 'Recent Reboot (<24h)'
    : isHighUptime
      ? 'Rock Solid (30d+)'
      : 'Online & Stable';

  const threadCount = host.cpu.cores.length || 1;
  const load1mPercent = Math.min(100, Math.round((host.cpu.loadAvg[0] / threadCount) * 100));

  const idlePercent = uptimeInfo?.lifetimeIdlePercent ?? 92.5;
  const activePercent = uptimeInfo?.lifetimeActivePercent ?? Math.max(0, 100 - idlePercent);

  return (
    <div className={cn('surface p-4.5 sm:p-5 relative overflow-hidden', className)}>
      {/* Background glow accent */}
      <div className="absolute -top-16 -right-16 h-36 w-36 rounded-full bg-brand/5 blur-3xl pointer-events-none" />

      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 rounded-lg border border-border bg-muted/80 p-2 text-foreground">
            <Clock className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground tracking-tight">Server Uptime</h3>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
              </span>
            </div>
            <p className="font-mono text-2xs text-muted-foreground truncate">
              {host.hostname} · {host.os}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {days >= 7 && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-mono font-medium bg-brand-soft text-brand border border-brand/20">
              <ShieldCheck className="h-3 w-3" />
              {days}d streak
            </span>
          )}
          <Badge variant={statusVariant} className="font-mono text-2xs font-medium gap-1">
            {isFreshBoot ? <RefreshCw className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
            {statusText}
          </Badge>
        </div>
      </div>

      {/* Main Uptime Display & Metrics Grid */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
        {/* Large Counter Block */}
        <div className="lg:col-span-6 flex flex-col justify-center">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            Continuous Operation
          </span>
          <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
            {days > 0 && (
              <div className="flex items-baseline gap-1">
                <span className="tabular font-mono text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  {days}
                </span>
                <span className="text-xs sm:text-sm font-medium text-muted-foreground">days</span>
              </div>
            )}
            <div className="flex items-baseline gap-1">
              <span className="tabular font-mono text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {String(hours).padStart(2, '0')}
              </span>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground">hrs</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="tabular font-mono text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {String(minutes).padStart(2, '0')}
              </span>
              <span className="text-xs sm:text-sm font-medium text-muted-foreground">min</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="tabular font-mono text-2xl sm:text-3xl font-bold tracking-tight text-brand">
                {String(seconds).padStart(2, '0')}
              </span>
              <span className="text-xs sm:text-sm font-medium text-brand/70">sec</span>
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 text-2xs font-mono text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span>Booted on {bootFormatted}</span>
          </div>
        </div>

        {/* Secondary Info Tiles */}
        <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Lifetime CPU Efficiency */}
          <div className="rounded-lg border border-border/70 bg-card/40 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Cpu className="h-3 w-3 text-muted-foreground" />
                Lifetime Efficiency
              </span>
              <span className="font-mono font-medium text-foreground">{idlePercent.toFixed(1)}% idle</span>
            </div>
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted flex">
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${activePercent}%` }}
                  title={`${activePercent.toFixed(1)}% active workload since boot`}
                />
                <div
                  className="h-full bg-ok/50 transition-all"
                  style={{ width: `${idlePercent}%` }}
                  title={`${idlePercent.toFixed(1)}% idle headroom since boot`}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-3xs text-muted-foreground">
                <span>{activePercent.toFixed(1)}% active</span>
                <span>{idlePercent.toFixed(1)}% idle headroom</span>
              </div>
            </div>
          </div>

          {/* Load Capacity vs Threads */}
          <div className="rounded-lg border border-border/70 bg-card/40 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3 w-3 text-muted-foreground" />
                Load Profile
              </span>
              <span className="font-mono font-medium text-foreground">{threadCount} cores</span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline justify-between font-mono text-2xs">
                <span className="text-muted-foreground">1m / 5m / 15m</span>
                <span className="font-medium text-foreground">
                  {host.cpu.loadAvg.map((n) => n.toFixed(2)).join(' · ')}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-3xs text-muted-foreground">
                <span>Load: {load1mPercent}% of capacity</span>
                <span className={cn(load1mPercent > 85 ? 'text-crit' : 'text-ok')}>
                  {load1mPercent > 85 ? 'Heavy Load' : 'Optimal Capacity'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
