import React from 'react';
import { HardDrive, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Progress } from '../ui/Progress';
import { DiskMount } from '../../types/dashboard';
import { formatBytes } from '../../lib/utils';

interface StorageGaugesProps {
  disks?: DiskMount[];
}

export function StorageGauges({ disks = [] }: StorageGaugesProps) {
  if (disks.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {disks.map((disk) => {
        const isNas = disk.mountPoint.includes('nas');
        const usedFormatted = formatBytes(disk.usedBytes);
        const freeFormatted = formatBytes(disk.freeBytes);
        const totalFormatted = formatBytes(disk.totalBytes);

        return (
          <Card
            key={disk.mountPoint}
            className={`glass-card relative overflow-hidden transition-all ${
              disk.isCritical
                ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50/40 dark:bg-gradient-to-br dark:from-rose-950/20 dark:via-slate-900/60 dark:to-slate-900/60 shadow-[0_0_20px_rgba(251,113,133,0.1)]'
                : 'border-border'
            }`}
          >
            {disk.isCritical && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-rose-400/10 rounded-full blur-2xl pointer-events-none" />
            )}

            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      disk.isCritical
                        ? 'bg-rose-100 dark:bg-rose-500/20 border-rose-300 dark:border-rose-500/40 text-rose-600 dark:text-rose-300'
                        : 'bg-sky-100 dark:bg-sky-500/20 border-sky-300 dark:border-sky-500/40 text-sky-600 dark:text-sky-300'
                    }`}
                  >
                    <HardDrive className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-foreground">{disk.label}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {disk.mountPoint} • {disk.fsType.toUpperCase()}
                    </p>
                  </div>
                </div>

                {disk.isCritical ? (
                  <Badge variant="pastel-peach" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Critical Capacity
                  </Badge>
                ) : (
                  <Badge variant="pastel-mint" className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Healthy
                  </Badge>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-2xl font-extrabold font-mono tracking-tight ${
                        disk.isCritical ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
                      }`}
                    >
                      {disk.usedPercent.toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-foreground">capacity used</span>
                  </div>
                  <div className="text-xs text-foreground font-mono font-medium">
                    <strong className={disk.isCritical ? 'text-rose-600 dark:text-rose-300' : 'text-foreground'}>
                      {freeFormatted}
                    </strong>{' '}
                    free of {totalFormatted}
                  </div>
                </div>

                <Progress
                  value={disk.usedPercent}
                  variant={disk.isCritical ? 'pastel-peach' : 'pastel-sky'}
                  height="md"
                />
              </div>

              <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">Used: {usedFormatted}</span>
                {isNas ? (
                  <span className="text-amber-700 dark:text-amber-300/90 text-[11px] font-medium">
                    Includes /export/RamSetu (93%)
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[11px]">Docker & Media Configs</span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
