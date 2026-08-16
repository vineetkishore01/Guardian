import React from 'react';
import { HardDrive } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Progress } from '../ui/Progress';
import { DiskMount } from '../../types/dashboard';
import { formatBytes, severityFor, severityTextClass } from '../../lib/utils';

interface StorageGaugesProps {
  disks?: DiskMount[];
}

const STATUS_LABEL = {
  ok: 'Healthy',
  warn: 'Filling up',
  crit: 'Low space',
} as const;

export function StorageGauges({ disks = [] }: StorageGaugesProps) {
  if (disks.length === 0) {
    return (
      <div className="surface p-6 text-center text-xs text-muted-foreground">
        No mounted filesystems reported.
      </div>
    );
  }

  return (
    // A lone volume takes the full width rather than sitting in a two-column
    // grid with an empty cell beside it.
    <div className={`grid grid-cols-1 gap-3 ${disks.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {disks.map((disk) => {
        // Derive severity from the number rather than trusting a flag computed
        // upstream, so the badge, bar and figure can never disagree.
        const severity = severityFor(disk.usedPercent, 80, 90);

        return (
          <div key={disk.mountPoint} className="surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="shrink-0 rounded-md border border-border bg-muted p-2 text-muted-foreground">
                  <HardDrive className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-medium text-foreground">{disk.label}</h4>
                  <p className="truncate font-mono text-2xs text-muted-foreground">
                    {disk.mountPoint}
                    {disk.fsType ? ` · ${disk.fsType}` : ''}
                    {disk.device ? ` · ${disk.device}` : ''}
                  </p>
                </div>
              </div>

              <Badge variant={severity === 'ok' ? 'ok' : severity}>{STATUS_LABEL[severity]}</Badge>
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`tabular text-[22px] font-semibold leading-none tracking-tight ${severityTextClass(
                      severity
                    )}`}
                  >
                    {disk.usedPercent.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">% used</span>
                </div>
                <span className="font-mono text-2xs text-muted-foreground">
                  <span className="text-foreground">{formatBytes(disk.freeBytes)}</span> free of{' '}
                  {formatBytes(disk.totalBytes)}
                </span>
              </div>

              <Progress
                value={disk.usedPercent}
                severity={severity}
                height="sm"
                className="mt-2.5"
              />

              <div className="mt-2 flex items-center justify-between font-mono text-2xs text-muted-foreground">
                <span>{formatBytes(disk.usedBytes)} used</span>
                <span>{formatBytes(disk.totalBytes)} capacity</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
