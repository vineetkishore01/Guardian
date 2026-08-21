import React from 'react';
import { Cpu, Zap, Fan, Thermometer, Activity } from 'lucide-react';
import { GpuTelemetry } from '../../types/dashboard';
import { formatBytes, cn } from '../../lib/utils';

interface GpuCardProps {
  gpu: GpuTelemetry;
  onClick?: () => void;
}

export function GpuCard({ gpu, onClick }: GpuCardProps) {
  const isHighLoad = gpu.utilizationPercent >= 85;
  const isWarm = (gpu.temperatureC ?? 0) >= 80;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/80 bg-card/90 p-4 transition-all duration-200 hover:border-brand/50 hover:shadow-md',
        onClick && 'cursor-pointer'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-foreground">{gpu.name}</h4>
            <p className="truncate text-2xs text-muted-foreground">
              {gpu.driver ? `Driver ${gpu.driver}` : 'Graphics Processor'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {gpu.temperatureC !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium',
                isWarm ? 'bg-crit-soft text-crit' : 'bg-muted text-muted-foreground'
              )}
            >
              <Thermometer className="h-2.5 w-2.5" />
              {gpu.temperatureC}°C
            </span>
          )}
          {gpu.powerWatts !== undefined && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
              <Zap className="h-2.5 w-2.5 text-warn" />
              {Math.round(gpu.powerWatts)}W
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
        {/* Core Load */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-2xs">
            <span className="text-muted-foreground">Core Load</span>
            <span
              className={cn(
                'font-mono font-semibold',
                isHighLoad ? 'text-crit' : 'text-foreground'
              )}
            >
              {gpu.utilizationPercent}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isHighLoad
                  ? 'bg-gradient-to-r from-warn to-crit'
                  : 'bg-gradient-to-r from-brand to-brand-strong'
              )}
              style={{ width: `${Math.min(100, Math.max(0, gpu.utilizationPercent))}%` }}
            />
          </div>
        </div>

        {/* VRAM Memory */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-2xs">
            <span className="text-muted-foreground">VRAM</span>
            <span className="font-mono font-semibold text-foreground">
              {gpu.memoryTotalBytes > 0
                ? `${formatBytes(gpu.memoryUsedBytes, 0)} / ${formatBytes(gpu.memoryTotalBytes, 0)}`
                : `${gpu.memoryPercent}%`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-brand transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, gpu.memoryPercent))}%` }}
            />
          </div>
        </div>
      </div>

      {gpu.fanSpeedPercent !== undefined && (
        <div className="mt-2.5 flex items-center justify-between text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Fan className={cn('h-3 w-3', gpu.fanSpeedPercent > 0 && 'animate-spin')} />
            Fan Speed
          </span>
          <span className="font-mono">{gpu.fanSpeedPercent}%</span>
        </div>
      )}
    </div>
  );
}
