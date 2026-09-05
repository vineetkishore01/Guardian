import React from 'react';
import { HardDrive, Thermometer } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Progress } from '../ui/Progress';
import { DiskMount, DiskTrend } from '../../types/dashboard';
import { formatBytes, severityFor, severityTextClass, cn } from '../../lib/utils';

interface StorageGaugesProps {
  disks?: DiskMount[];
  trends?: DiskTrend[];
  onOpenHistory?: () => void;
}

/**
 * Turns a fit into a sentence.
 *
 * "+40 GB/day" is a fact; "about 10 days until full" is the thing that makes
 * someone act, so the estimate leads and the rate supports it.
 */
function describeTrend(trend: DiskTrend): { text: string; urgent: boolean } | null {
  const perDay = formatBytes(Math.abs(trend.bytesPerDay));

  if (trend.direction === 'stable') return { text: 'Stable', urgent: false };
  if (trend.direction === 'draining') return { text: `Freeing ${perDay}/day`, urgent: false };

  if (trend.daysUntilFull === undefined) {
    return { text: `Filling ${perDay}/day`, urgent: false };
  }
  const days = trend.daysUntilFull;
  const when =
    days < 1
      ? `full in under a day`
      : days < 2
        ? `full in about a day`
        : `full in about ${Math.round(days)} days`;
  return { text: `+${perDay}/day - ${when}`, urgent: days <= 14 };
}

const STATUS_LABEL = {
  ok: 'Healthy',
  warn: 'Filling up',
  crit: 'Low space',
} as const;

export function StorageGauges({ disks = [], trends = [], onOpenHistory }: StorageGaugesProps) {
  const visibleDisks = disks.filter(
    (d) =>
      !/^\/(boot|efi)(\/|$)/i.test(d.mountPoint) &&
      !/^(efi|boot)$/i.test(d.label || '')
  );

  if (visibleDisks.length === 0) {
    return (
      <div className="surface p-6 text-center text-xs text-muted-foreground">
        No mounted filesystems reported.
      </div>
    );
  }

  return (
    // A lone volume takes the full width rather than sitting in a two-column
    // grid with an empty cell beside it.
    <div className={`grid grid-cols-1 gap-3 ${visibleDisks.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {visibleDisks.map((disk) => {
        // Derive severity from the number rather than trusting a flag computed
        // upstream, so the badge, bar and figure can never disagree.
        const severity = severityFor(disk.usedPercent, 80, 90);
        const trend = trends.find((t) => t.mountPoint === disk.mountPoint);
        const trendText = trend ? describeTrend(trend) : null;

        return (
          <div
            key={disk.mountPoint}
            className={`surface p-4 ${onOpenHistory ? 'surface-interactive' : ''}`}
            onClick={onOpenHistory}
            onKeyDown={
              onOpenHistory
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenHistory();
                    }
                  }
                : undefined
            }
            role={onOpenHistory ? 'button' : undefined}
            tabIndex={onOpenHistory ? 0 : undefined}
            title={onOpenHistory ? 'View disk usage history' : undefined}
          >
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

              <div className="flex items-center gap-1.5 shrink-0">
                {disk.tempC !== undefined && (
                  <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-mono font-medium bg-muted text-muted-foreground">
                    <Thermometer className="h-2.5 w-2.5" />
                    {disk.tempC}°C
                  </span>
                )}
                <Badge variant={severity === 'ok' ? 'ok' : severity}>{STATUS_LABEL[severity]}</Badge>
              </div>
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

              {/* A percentage tells you where the volume is; only the trend
                  tells you where it is going. */}
              {trendText && (
                <div
                  className={cn(
                    'mt-1.5 text-2xs',
                    trendText.urgent ? 'font-medium text-warn' : 'text-muted-foreground'
                  )}
                  title={`Fitted over ${trend!.sampleCount} hourly samples spanning ${trend!.spanHours}h.`}
                >
                  {trendText.text}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
