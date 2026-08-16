import React from 'react';
import {
  Cpu,
  Activity,
  Thermometer,
  ArrowDown,
  ArrowUp,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Progress } from '../ui/Progress';
import { LiveSparkline } from '../charts/LiveSparkline';
import { HostTelemetry, HistoryPoint } from '../../types/dashboard';
import { formatBytes, formatRate } from '../../lib/utils';

interface HostStatsBarProps {
  host?: HostTelemetry;
  history?: HistoryPoint[];
}

export function HostStatsBar({ host, history = [] }: HostStatsBarProps) {
  if (!host) return null;

  const cpuUsage = host.cpu.usagePercent || 0;
  const memUsed = host.memory.usedPercent || 0;
  const ramTotalFormatted = formatBytes(host.memory.totalBytes);
  const ramUsedFormatted = formatBytes(host.memory.usedBytes);
  const ramAvailableFormatted = formatBytes(host.memory.availableBytes);

  const swapUsedFormatted = formatBytes(host.memory.swapUsedBytes);
  const swapTotalFormatted = formatBytes(host.memory.swapTotalBytes);

  const primaryThermal =
    host.thermals.find((t) => t.label.includes('pkg') || t.label.includes('cpu')) ||
    host.thermals[0] || { tempC: 47, label: 'x86_pkg_temp', isCritical: false };

  const eno1 = host.network.find((n) => n.name === 'eno1') || host.network[0];
  const tailscale0 = host.network.find((n) => n.name === 'tailscale0');

  const cpuHistory = history.map((h) => h.cpu);
  const ramHistory = history.map((h) => h.ram);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. CPU Usage Card (Pastel Sky) */}
      <Card className="glass-card relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-3 opacity-10 dark:opacity-20 group-hover:opacity-30 transition-opacity">
          <Cpu className="h-14 w-14 text-sky-400" />
        </div>
        <CardContent className="p-4 sm:p-5 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-sky-500" />
                CPU Utilization
              </span>
              <Badge variant="pastel-sky">
                {host.cpu.cores.length || 8} Threads
              </Badge>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-foreground font-mono tracking-tight">
                {cpuUsage.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">overall load</span>
            </div>

            <div className="mt-3">
              <Progress value={cpuUsage} variant="pastel-sky" height="sm" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-muted-foreground/70">Load:</span>
              <span className="text-foreground font-medium">{host.cpu.loadAvg[0]}</span>
              <span className="text-muted-foreground/70">/</span>
              <span className="text-foreground">{host.cpu.loadAvg[1]}</span>
              <span className="text-muted-foreground/70">/</span>
              <span className="text-foreground">{host.cpu.loadAvg[2]}</span>
            </div>
            <div className="h-6">
              <LiveSparkline data={cpuHistory} width={65} height={22} color="#7dd3fc" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. RAM & Swap Card (Pastel Lavender) */}
      <Card className="glass-card relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-3 opacity-10 dark:opacity-20 group-hover:opacity-30 transition-opacity">
          <Activity className="h-14 w-14 text-violet-400" />
        </div>
        <CardContent className="p-4 sm:p-5 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-violet-500" />
                Memory & Swap
              </span>
              <Badge variant="pastel-lavender">
                {ramAvailableFormatted} Free
              </Badge>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-foreground font-mono tracking-tight">
                {memUsed.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {ramUsedFormatted} / {ramTotalFormatted}
              </span>
            </div>

            <div className="mt-3">
              <Progress value={memUsed} variant="pastel-lavender" height="sm" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1 font-mono">
              <span className="text-muted-foreground/70">Swap:</span>
              <span className="text-amber-600 dark:text-amber-300 font-medium">{swapUsedFormatted}</span>
              <span className="text-muted-foreground/70">/ {swapTotalFormatted}</span>
            </div>
            <div className="h-6">
              <LiveSparkline data={ramHistory} width={65} height={22} color="#c4b5fd" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Thermals Card (Pastel Mint) */}
      <Card className="glass-card relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-3 opacity-10 dark:opacity-20 group-hover:opacity-30 transition-opacity">
          <Thermometer className="h-14 w-14 text-emerald-400" />
        </div>
        <CardContent className="p-4 sm:p-5 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Thermometer className="h-3.5 w-3.5 text-emerald-500" />
                Thermals
              </span>
              <Badge variant="pastel-mint">
                Optimal
              </Badge>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-foreground font-mono tracking-tight">
                {primaryThermal.tempC.toFixed(1)}°C
              </span>
              <span className="text-xs text-muted-foreground">{primaryThermal.label}</span>
            </div>

            <div className="mt-3">
              <Progress
                value={Math.min(100, (primaryThermal.tempC / 90) * 100)}
                variant="pastel-mint"
                height="sm"
              />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2 font-mono">
              {host.thermals.slice(1, 3).map((t) => (
                <span key={t.name} className="text-muted-foreground">
                  {t.label.replace('pch_cannonlake', 'pch')}: <strong className="text-foreground">{t.tempC}°C</strong>
                </span>
              ))}
            </div>
            <div className="h-6">
              <LiveSparkline
                data={history.map((h) => h.temp)}
                width={65}
                height={22}
                color="#6ee7b7"
                min={30}
                max={90}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. Network I/O Card (Pastel Peach/Sky) */}
      <Card className="glass-card relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-3 opacity-10 dark:opacity-20 group-hover:opacity-30 transition-opacity">
          <Zap className="h-14 w-14 text-sky-400" />
        </div>
        <CardContent className="p-4 sm:p-5 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-sky-500" />
                Network I/O
              </span>
              <Badge variant="pastel-sky">eno1 (LAN)</Badge>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <ArrowDown className="h-3 w-3" />
                  <span>Receive</span>
                </div>
                <div className="text-lg font-bold text-foreground font-mono">
                  {formatRate(eno1 ? eno1.rxBytesPerSec : 0)}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 font-medium">
                  <ArrowUp className="h-3 w-3" />
                  <span>Transmit</span>
                </div>
                <div className="text-lg font-bold text-foreground font-mono">
                  {formatRate(eno1 ? eno1.txBytesPerSec : 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground font-mono">
            <span>Tailscale:</span>
            <span className="text-foreground font-medium">
              ↓ {formatRate(tailscale0 ? tailscale0.rxBytesPerSec : 0)} • ↑{' '}
              {formatRate(tailscale0 ? tailscale0.txBytesPerSec : 0)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
