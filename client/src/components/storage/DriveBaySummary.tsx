import React from 'react';
import { PhysicalDisk } from '../../types/dashboard';
import { formatBytes, cn } from '../../lib/utils';
import {
  formatPowerHours,
  getDriveIcon,
  getTempSeverity,
  getMediaBucket,
  driveShortName,
} from './diskPresentation';

interface DriveBaySummaryProps {
  disks: PhysicalDisk[];
  onInspect: (device: string) => void;
  className?: string;
}

const HEALTH_LABEL: Record<PhysicalDisk['health'], string> = {
  passed: 'Passed',
  warning: 'Warning',
  critical: 'Failing',
  unknown: 'Unknown',
};

const HEALTH_DOT_CLASS: Record<PhysicalDisk['health'], string> = {
  passed: 'bg-ok',
  warning: 'bg-warn',
  critical: 'bg-crit',
  unknown: 'bg-muted-foreground',
};

function mediaMixLabel(disks: PhysicalDisk[]): string {
  const counts = { nvme: 0, ssd: 0, hdd: 0 };
  for (const disk of disks) {
    counts[getMediaBucket(disk)] += 1;
  }
  const parts: string[] = [];
  if (counts.nvme > 0) parts.push(`${counts.nvme} NVMe`);
  if (counts.ssd > 0) parts.push(`${counts.ssd} SSD`);
  if (counts.hdd > 0) parts.push(`${counts.hdd} HDD`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function DriveBaySummary({ disks, onInspect, className }: DriveBaySummaryProps) {
  const totalBytes = disks.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);

  const temps = disks
    .map((d) => d.tempC)
    .filter((t): t is number => t !== undefined && Number.isFinite(t));
  const maxTemp = temps.length > 0 ? Math.max(...temps) : undefined;
  const minTemp = temps.length > 0 ? Math.min(...temps) : undefined;
  const thermalSeverity = getTempSeverity(maxTemp);

  const powerOnHours = disks
    .map((d) => d.powerOnHours)
    .filter((h): h is number => h !== undefined && Number.isFinite(h));
  const oldestHours = powerOnHours.length > 0 ? Math.max(...powerOnHours) : undefined;

  return (
    <div className={cn('surface p-3.5', className)}>
      {/* Summary stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <span className="block text-3xs uppercase font-mono text-muted-foreground">Raw Capacity</span>
          <span className="text-xs font-mono font-semibold text-foreground">
            {formatBytes(totalBytes)}
          </span>
        </div>
        <div>
          <span className="block text-3xs uppercase font-mono text-muted-foreground">Media Mix</span>
          <span className="text-xs font-mono font-semibold text-foreground">{mediaMixLabel(disks)}</span>
        </div>
        <div>
          <span className="block text-3xs uppercase font-mono text-muted-foreground">Thermals</span>
          <span
            className={cn(
              'text-xs font-mono font-semibold text-foreground',
              thermalSeverity === 'crit' && 'text-crit',
              thermalSeverity === 'warn' && 'text-warn'
            )}
          >
            {maxTemp !== undefined
              ? `${maxTemp}°C peak${minTemp !== undefined && minTemp !== maxTemp ? ` · ${minTemp}-${maxTemp}°C` : ''}`
              : '—'}
          </span>
        </div>
        <div>
          <span className="block text-3xs uppercase font-mono text-muted-foreground">Oldest Drive</span>
          <span className="text-xs font-mono font-semibold text-foreground">
            {formatPowerHours(oldestHours)}
          </span>
        </div>
      </div>

      {/* Drive chip matrix */}
      <div className="mt-3 border-t border-border/50 pt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-2">
        {disks.map((disk) => {
          const isCrit = disk.health === 'critical';
          const isWarn = disk.health === 'warning';
          const tempSeverity = getTempSeverity(disk.tempC);
          const healthLabel = HEALTH_LABEL[disk.health] ?? 'Unknown';

          return (
            <button
              key={disk.device}
              type="button"
              onClick={() => onInspect(disk.device)}
              title={`${disk.model} · ${disk.device} · ${healthLabel}`}
              className={cn(
                'rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left transition-colors',
                'hover:border-brand/40 hover:bg-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isCrit && 'border-crit/50 bg-crit-soft/15',
                isWarn && 'border-warn/40 bg-warn-soft/15'
              )}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                {getDriveIcon(disk, 'h-3.5 w-3.5')}
                <span className="truncate font-mono text-2xs font-semibold text-foreground">
                  {driveShortName(disk)}
                </span>
                <span
                  className={cn('ml-auto h-2 w-2 shrink-0 rounded-full', HEALTH_DOT_CLASS[disk.health])}
                  role="img"
                  title={`Health: ${healthLabel}`}
                  aria-label={`Health: ${healthLabel}`}
                />
              </span>
              <span className="mt-0.5 flex items-center gap-1 font-mono text-3xs text-muted-foreground truncate">
                <span className="truncate">{formatBytes(disk.sizeBytes)}</span>
                {disk.tempC !== undefined && (
                  <>
                    <span>·</span>
                    <span
                      className={cn(
                        tempSeverity === 'crit' && 'text-crit',
                        tempSeverity === 'warn' && 'text-warn'
                      )}
                    >
                      {disk.tempC}°C
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
