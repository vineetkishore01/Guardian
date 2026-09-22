import React from 'react';
import { Thermometer, ChevronDown, ChevronUp, FolderTree } from 'lucide-react';
import { PhysicalDisk } from '../../types/dashboard';
import { Badge } from '../ui/Badge';
import { formatBytes, cn } from '../../lib/utils';
import { formatPowerHours, getDriveIcon, getMediaLabel, getHealthBadge } from './diskPresentation';

interface DiskDetailCardProps {
  disk: PhysicalDisk;
  expanded: boolean;
  onToggleExpand: () => void;
  /** When true the SMART attribute table renders always-open, no toggle button (modal detail pane). */
  alwaysExpanded?: boolean;
  className?: string;
}

export function DiskDetailCard({
  disk,
  expanded,
  onToggleExpand,
  alwaysExpanded = false,
  className,
}: DiskDetailCardProps) {
  const isExpanded = alwaysExpanded || expanded;
  const isCrit = disk.health === 'critical';
  const isWarn = disk.health === 'warning';

  // Critical counters
  const realloc = disk.reallocatedSectors ?? 0;
  const pending = disk.pendingSectors ?? 0;
  const uncorrect = disk.uncorrectableSectors ?? 0;
  const crc = disk.crcErrors ?? 0;
  const mediaErr = disk.mediaErrors ?? 0;

  // Temperature severity
  const temp = disk.tempC;
  const tempVariant =
    temp !== undefined ? (temp >= 55 ? 'crit' : temp >= 45 ? 'warn' : 'default') : null;

  return (
    <div
      className={cn(
        'surface p-4 transition-all duration-150',
        isCrit && 'border-crit/50 bg-crit-soft/10',
        isWarn && 'border-warn/40 bg-warn-soft/10',
        className
      )}
    >
      {/* Drive Top Bar */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="shrink-0 rounded-md border border-border bg-muted p-2 text-foreground mt-0.5">
            {getDriveIcon(disk)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="truncate text-sm font-semibold text-foreground tracking-tight">
                {disk.model}
              </h4>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-3xs font-medium text-muted-foreground uppercase">
                {getMediaLabel(disk)}
              </span>
              {disk.isSynthetic && (
                <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground/80">
                  Demo Sample
                </span>
              )}
            </div>
            <p className="truncate font-mono text-2xs text-muted-foreground mt-0.5">
              <span className="text-foreground font-medium">{disk.device}</span>
              {disk.serial && <span> · SN: {disk.serial}</span>}
              {disk.firmware && <span> · FW: {disk.firmware}</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {temp !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-mono font-medium bg-muted',
                tempVariant === 'crit' && 'bg-crit-soft text-crit font-semibold',
                tempVariant === 'warn' && 'bg-warn-soft text-warn'
              )}
            >
              <Thermometer className="h-2.5 w-2.5" />
              {temp}°C
            </span>
          )}
          {getHealthBadge(disk.health)}
        </div>
      </div>

      {/* Main Specs & Telemetry Row */}
      <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 border-t border-border/50 text-2xs font-mono">
        <div>
          <span className="text-muted-foreground block text-3xs uppercase">Capacity</span>
          <span className="font-semibold text-foreground text-xs">{formatBytes(disk.sizeBytes)}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-3xs uppercase">Power-On Time</span>
          <span className="text-foreground" title={`${disk.powerOnHours || 0} lifetime hours`}>
            {formatPowerHours(disk.powerOnHours)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block text-3xs uppercase">Power Cycles</span>
          <span className="text-foreground">{disk.powerCycles ?? '—'}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-3xs uppercase">
            {disk.protocol === 'nvme' || disk.mediaType === 'ssd' ? 'Endurance' : 'Spindle'}
          </span>
          <span className="text-foreground">
            {disk.healthPercent !== undefined
              ? `${disk.healthPercent}% Health`
              : disk.rotationRate
                ? `${disk.rotationRate} RPM`
                : 'Solid State'}
          </span>
        </div>
      </div>

      {/* SSD Wearout / TBW Progress Bar (if available) */}
      {disk.healthPercent !== undefined && (
        <div className="mt-3">
          <div className="flex items-center justify-between font-mono text-2xs">
            <span className="text-muted-foreground text-3xs uppercase">
              SSD Life Remaining ({disk.healthPercent}% healthy)
            </span>
            <span className="text-muted-foreground text-3xs">
              {disk.tbw !== undefined ? `${disk.tbw} TBW` : `${disk.wearoutPercent ?? 0}% wear`}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                disk.healthPercent <= 10 ? 'bg-crit' : disk.healthPercent <= 20 ? 'bg-warn' : 'bg-brand'
              )}
              style={{ width: `${Math.min(100, Math.max(0, disk.healthPercent))}%` }}
            />
          </div>
        </div>
      )}

      {/* Critical Health Indicators Grid */}
      <div className="mt-3 rounded-lg border border-border/70 bg-card/40 p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-3xs uppercase font-mono font-medium tracking-wide text-muted-foreground">
            S.M.A.R.T. Health Indicators
          </span>
          <span className="font-mono text-3xs text-muted-foreground">0 is optimal</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs font-mono">
          <div className="flex flex-col">
            <span className="text-muted-foreground text-3xs">Reallocated</span>
            <span className={cn('font-semibold', realloc > 0 ? 'text-crit' : 'text-ok')}>
              {realloc}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground text-3xs">Pending</span>
            <span className={cn('font-semibold', pending > 0 ? 'text-crit' : 'text-ok')}>
              {pending}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground text-3xs">Uncorrectable</span>
            <span className={cn('font-semibold', uncorrect > 0 ? 'text-crit' : 'text-ok')}>
              {uncorrect}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground text-3xs">CRC Errors</span>
            <span className={cn('font-semibold', crc > 0 ? 'text-warn' : 'text-ok')}>
              {crc}
            </span>
          </div>
        </div>
        {mediaErr > 0 && (
          <div className="mt-1.5 font-mono text-3xs text-crit font-medium">
            ⚠️ {mediaErr} NVMe media &amp; data integrity errors detected!
          </div>
        )}
      </div>

      {/* Associated Filesystem Mounts */}
      {disk.partitions && disk.partitions.length > 0 && (
        <div className="mt-3">
          <span className="text-3xs uppercase font-mono text-muted-foreground block mb-1">
            Mapped Volumes &amp; Partitions
          </span>
          <div className="flex flex-wrap gap-1.5">
            {disk.partitions.map((part) => (
              <div
                key={part.device}
                className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-muted/60 px-2 py-1 font-mono text-2xs text-muted-foreground"
              >
                <FolderTree className="h-3 w-3 text-brand" />
                <span className="font-medium text-foreground">{part.name}</span>
                {part.mountPoint && (
                  <span className="text-brand">→ {part.mountPoint}</span>
                )}
                {part.label && <span>({part.label})</span>}
                {part.fsType && <span className="text-muted-foreground/80">· {part.fsType}</span>}
                {part.usedPercent !== undefined && (
                  <span className={cn(part.usedPercent >= 90 ? 'text-crit' : 'text-muted-foreground')}>
                    · {part.usedPercent.toFixed(0)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable S.M.A.R.T. Attributes Drawer */}
      {disk.smartAttributes && disk.smartAttributes.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border/50">
          {!alwaysExpanded && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex w-full items-center justify-between text-2xs font-mono text-brand hover:underline py-1"
            >
              <span>
                {isExpanded ? 'Hide' : 'Inspect'} All S.M.A.R.T. Attributes ({disk.smartAttributes.length})
              </span>
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}

          {isExpanded && (
            <div className="mt-2 overflow-x-auto rounded border border-border/60 bg-muted/30 p-1.5">
              <table className="w-full text-left font-mono text-2xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground text-3xs uppercase">
                    <th className="py-1 px-1.5">ID</th>
                    <th className="py-1 px-1.5">Attribute Name</th>
                    <th className="py-1 px-1.5 text-right">Current</th>
                    <th className="py-1 px-1.5 text-right">Worst</th>
                    <th className="py-1 px-1.5 text-right">Thresh</th>
                    <th className="py-1 px-1.5 text-right">Raw</th>
                    <th className="py-1 px-1.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {disk.smartAttributes.map((attr) => (
                    <tr
                      key={attr.id}
                      className={cn(
                        'hover:bg-muted/50 transition-colors',
                        attr.status === 'crit' && 'bg-crit-soft/20 text-crit',
                        attr.status === 'warn' && 'bg-warn-soft/20 text-warn'
                      )}
                    >
                      <td className="py-1 px-1.5 text-muted-foreground">{attr.id}</td>
                      <td className="py-1 px-1.5 font-medium text-foreground">{attr.name}</td>
                      <td className="py-1 px-1.5 text-right">{attr.value}</td>
                      <td className="py-1 px-1.5 text-right text-muted-foreground">{attr.worst}</td>
                      <td className="py-1 px-1.5 text-right text-muted-foreground">{attr.threshold}</td>
                      <td className="py-1 px-1.5 text-right font-medium">{attr.rawFormatted}</td>
                      <td className="py-1 px-1.5 text-center">
                        <Badge
                          variant={attr.status === 'crit' ? 'crit' : attr.status === 'warn' ? 'warn' : 'ok'}
                          className="text-3xs px-1 py-0 uppercase"
                        >
                          {attr.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
