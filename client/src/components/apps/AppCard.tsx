import React, { useState } from 'react';
import { ArrowUpRight, Settings2, Pin, Trash2, ScrollText, AlertTriangle, RotateCcw, Loader2, ArrowDown, ArrowDownToLine , HardDrive, Gauge } from 'lucide-react';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../../types/dashboard';
import {
  resolveContainerUrl,
  resolveBookmarkUrl,
  formatBytes,
  formatRate,
  cn,
  containerIssues,
  containerSeverity,
} from '../../lib/utils';

interface AppCardProps {
  item: ContainerItem | CustomAppBookmark;
  isCustomBookmark?: boolean;
  settings?: DashboardSettings;
  onEdit: (item: ContainerItem | CustomAppBookmark) => void;
  onDeleteBookmark?: (id: string) => void;
  /** Opens the Docker log viewer. Containers only. */
  onViewLogs?: (container: ContainerItem) => void;
  /** Restarts a Docker container. Containers only. */
  onRestartContainer?: (container: ContainerItem) => Promise<boolean | void>;
  /** Pulls the latest image and recreates/restarts the container. Containers only. */
  onUpdateContainer?: (container: ContainerItem) => Promise<boolean | void>;
}

const HEALTH_PRESENTATION: Record<string, { dot: string; label: string }> = {
  healthy: { dot: 'bg-ok', label: 'Healthy' },
  unhealthy: { dot: 'bg-crit', label: 'Unhealthy' },
  starting: { dot: 'bg-warn', label: 'Starting' },
};

const STATE_PRESENTATION: Record<string, { dot: string; label: string }> = {
  running: { dot: 'bg-ok', label: 'Running' },
  restarting: { dot: 'bg-warn', label: 'Restarting' },
  paused: { dot: 'bg-warn', label: 'Paused' },
  exited: { dot: 'bg-muted-foreground', label: 'Stopped' },
  dead: { dot: 'bg-crit', label: 'Dead' },
  created: { dot: 'bg-muted-foreground', label: 'Created' },
};

export function AppCard({
  item,
  isCustomBookmark = false,
  settings,
  onEdit,
  onDeleteBookmark,
  onViewLogs,
  onRestartContainer,
  onUpdateContainer,
}: AppCardProps) {
  const [imgError, setImgError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [updating, setUpdating] = useState(false);

  const container = !isCustomBookmark ? (item as ContainerItem) : null;
  const bookmark = isCustomBookmark ? (item as CustomAppBookmark) : null;

  const targetUrl = bookmark
    ? resolveBookmarkUrl(bookmark, settings)
    : container
    ? resolveContainerUrl(container, settings)
    : null;

  const hasValidUrl = Boolean(targetUrl && targetUrl !== '#' && !targetUrl.endsWith('/#'));
  const name = container?.displayName || item.name;
  const category = item.category || 'General';

  // Containers report health when they define a healthcheck; otherwise the
  // lifecycle state is the honest signal. Never claim "healthy" without one.
  const status = container
    ? HEALTH_PRESENTATION[container.health] ??
      STATE_PRESENTATION[container.state] ?? { dot: 'bg-muted-foreground', label: container.status }
    : null;

  const issues = container ? containerIssues(container) : [];
  const severity = container ? containerSeverity(container) : 'ok';
  const worstIssue = issues[0];

  const portLabel = container?.ports?.length
    ? container.ports
        .map((p) => p.publicPort || p.privatePort)
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .slice(0, 3)
        .join(', ')
    : null;

  const launch = () => {
    if (hasValidUrl && targetUrl) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
      onEdit(item);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      launch();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={launch}
      onKeyDown={handleKeyDown}
      aria-label={hasValidUrl ? `Open ${name}` : `Configure ${name}`}
      className={cn(
        'surface surface-interactive group flex h-full select-none flex-col p-3.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        item.pinned && !worstIssue && 'border-brand/30',
        severity === 'crit' && 'border-crit/50',
        severity === 'warn' && 'border-warn/40'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted p-1.5">
          {item.iconUrl && !imgError ? (
            <img
              src={item.iconUrl}
              alt=""
              onError={() => setImgError(true)}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          ) : (
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              {name.slice(0, 2)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="truncate text-sm font-medium text-foreground">{name}</h4>

            {/* Actions stay visible on touch and keyboard focus, not hover-only. */}
            <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {container && onUpdateContainer && (
                <button
                  type="button"
                  disabled={updating || restarting}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setUpdating(true);
                    try {
                      await onUpdateContainer(container);
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  aria-label={`Update image and restart ${name}`}
                  title={updating ? 'Pulling latest image & recreating…' : 'Update image & recreate container'}
                  className={cn(
                    'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    updating && 'text-brand'
                  )}
                >
                  {updating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                  ) : (
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  )}
                </button>
              )}

              {container && onRestartContainer && (
                <button
                  type="button"
                  disabled={restarting || updating}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setRestarting(true);
                    try {
                      await onRestartContainer(container);
                    } finally {
                      setRestarting(false);
                    }
                  }}
                  aria-label={`Restart ${name}`}
                  title={restarting ? 'Restarting container…' : 'Restart container'}
                  className={cn(
                    'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    restarting && 'text-warn'
                  )}
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', restarting && 'animate-spin')} />
                </button>
              )}

              {container && onViewLogs && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewLogs(container);
                  }}
                  aria-label={`View logs for ${name}`}
                  title="View container logs"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ScrollText className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(item);
                }}
                aria-label={`Configure ${name}`}
                title="Configure"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>

              {bookmark && onDeleteBookmark && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmDelete) {
                      onDeleteBookmark(bookmark.id);
                    } else {
                      setConfirmDelete(true);
                      window.setTimeout(() => setConfirmDelete(false), 3000);
                    }
                  }}
                  aria-label={confirmDelete ? `Confirm delete ${name}` : `Delete ${name}`}
                  title={confirmDelete ? 'Click again to confirm' : 'Delete bookmark'}
                  className={cn(
                    'rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    confirmDelete
                      ? 'bg-crit-soft text-crit'
                      : 'text-muted-foreground hover:bg-accent hover:text-crit'
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}

              {hasValidUrl && (
                <ArrowUpRight
                  className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-brand"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>

          <p className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-muted-foreground">
            {item.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-brand" aria-hidden="true" />}
            <span className="truncate">{category}</span>
            {portLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate font-mono">:{portLabel}</span>
              </>
            ) : container?.networkParent ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate" title={`Shares the network namespace of ${container.networkParent}`}>
                  via {container.networkParent}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/* Live In-Card App Widget (Plex, qBit, Pi-hole, Jellyfin, etc.) */}
      {item.widget && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-2xs">
          <span className="truncate text-muted-foreground">{item.widget.subtitle || item.widget.title}</span>
          {item.widget.badge && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 font-mono font-semibold shrink-0',
                item.widget.badgeColor === 'ok' && 'bg-ok-soft text-ok',
                item.widget.badgeColor === 'warn' && 'bg-warn-soft text-warn',
                // Without this the most urgent state fell through every branch
                // and rendered unstyled -- the one badge you must not miss was
                // the only one with no colour at all.
                item.widget.badgeColor === 'crit' && 'bg-crit-soft text-crit',
                item.widget.badgeColor === 'brand' && 'bg-brand-soft text-brand',
                (!item.widget.badgeColor || item.widget.badgeColor === 'muted') && 'bg-muted text-muted-foreground'
              )}
            >
              {item.widget.badge}
            </span>
          )}
        </div>
      )}

      {/*
        * The integrations already compute these -- Jellyfin's direct-vs-transcode
        * split, the *arr queue breakdown -- and until now every one of them was
        * thrown away at the render boundary. They are the detail behind the
        * badge, so they sit directly under it.
        */}
      {item.widget?.metrics && item.widget.metrics.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 px-0.5 text-2xs text-muted-foreground">
          {item.widget.metrics.map((m) => (
            <span key={m.label} className="inline-flex items-baseline gap-1">
              <span className="truncate">{m.label}</span>
              <span className="font-mono font-semibold text-foreground">{m.value}</span>
            </span>
          ))}
        </div>
      )}

      {item.widget?.statusText && (
        <div
          className={cn(
            'mt-1.5 truncate text-2xs font-medium',
            item.widget.badgeColor === 'crit' ? 'text-crit' : 'text-warn'
          )}
          title={item.widget.statusText}
        >
          {item.widget.statusText}
        </div>
      )}

      {/* Pushes the footer down so cards of differing content still align. */}
      <div className="flex-1" />

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-2xs text-muted-foreground">
        {worstIssue ? (
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 font-medium',
              worstIssue.severity === 'crit' ? 'text-crit' : 'text-warn'
            )}
            title={issues.map((i) => i.detail).join('\n\n')}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {issues.map((i) => i.label).join(' · ')}
            </span>
          </span>
        ) : status ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} aria-hidden="true" />
            <span className="truncate">{status.label}</span>
          </span>
        ) : (
          <span className="truncate">{bookmark?.description || 'Bookmark'}</span>
        )}

        {container && (container.cpuPercent !== undefined || container.memoryBytes !== undefined || container.networkRxBytesPerSec !== undefined || container.blockReadBytesPerSec !== undefined) && (
          <div className="flex shrink-0 items-center gap-1.5 font-mono">
            {((container.networkRxBytesPerSec || 0) > 1024 || (container.networkTxBytesPerSec || 0) > 1024) && (
              <span
                className="flex items-center gap-0.5 text-brand"
                title={`Network: ↓ ${formatRate(container.networkRxBytesPerSec || 0)}  ↑ ${formatRate(container.networkTxBytesPerSec || 0)}`}
              >
                <ArrowDown className="h-2.5 w-2.5" />
                {formatRate(container.networkRxBytesPerSec || 0)}
              </span>
            )}
            {/* Only shown while there is meaningful traffic, so idle cards stay quiet. */}
            {((container.blockReadBytesPerSec || 0) > 1024 || (container.blockWriteBytesPerSec || 0) > 1024) && (
              <span
                className="flex items-center gap-0.5 text-muted-foreground"
                title={`Disk: read ${formatRate(container.blockReadBytesPerSec || 0)}  write ${formatRate(
                  container.blockWriteBytesPerSec || 0
                )}`}
              >
                <HardDrive className="h-2.5 w-2.5" />
                {formatRate((container.blockReadBytesPerSec || 0) + (container.blockWriteBytesPerSec || 0))}
              </span>
            )}
            {container.cpuPercent !== undefined && (
              <span
                className={cn(
                  container.cpuThrottlingNow && 'text-warn font-semibold',
                  !container.cpuThrottlingNow && (container.cpuPercentOfLimit ?? 0) >= 90 && 'text-warn'
                )}
                title={
                  container.cpuLimitCores
                    ? `${container.cpuPercent.toFixed(1)}% of one core; capped at ${container.cpuLimitCores} CPU, so ${(container.cpuPercentOfLimit ?? 0).toFixed(0)}% of its own allowance.${container.cpuThrottlingNow ? ' Currently being throttled.' : ''}`
                    : `${container.cpuPercent.toFixed(1)}% of one core. No CPU limit set.`
                }
              >
                {container.cpuPercent.toFixed(1)}%
                {/* The share of its own cap is the number that predicts throttling. */}
                {container.cpuPercentOfLimit !== undefined && (
                  <span className="text-muted-foreground">
                    {' '}({container.cpuPercentOfLimit.toFixed(0)}% cap)
                  </span>
                )}
                {container.cpuThrottlingNow && <Gauge className="ml-1 inline h-2.5 w-2.5" />}
              </span>
            )}
            {container.cpuPercent !== undefined && container.memoryBytes !== undefined && ' · '}
            {container.memoryBytes !== undefined && formatBytes(container.memoryBytes, 0)}
          </div>
        )}
      </div>
    </div>
  );
}
