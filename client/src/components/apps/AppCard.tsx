import React, { useState } from 'react';
import { ArrowUpRight, Settings2, Pin, Trash2, ScrollText } from 'lucide-react';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../../types/dashboard';
import { resolveContainerUrl, resolveBookmarkUrl, formatBytes, cn } from '../../lib/utils';

interface AppCardProps {
  item: ContainerItem | CustomAppBookmark;
  isCustomBookmark?: boolean;
  settings?: DashboardSettings;
  onEdit: (item: ContainerItem | CustomAppBookmark) => void;
  onDeleteBookmark?: (id: string) => void;
  /** Opens the Docker log viewer. Containers only. */
  onViewLogs?: (container: ContainerItem) => void;
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
}: AppCardProps) {
  const [imgError, setImgError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        'surface surface-interactive group flex select-none flex-col p-3.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        item.pinned && 'border-brand/30'
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
            {portLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate font-mono">:{portLabel}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-2xs text-muted-foreground">
        {status ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} aria-hidden="true" />
            <span className="truncate">{status.label}</span>
          </span>
        ) : (
          <span className="truncate">{bookmark?.description || 'Bookmark'}</span>
        )}

        {container && (container.cpuPercent !== undefined || container.memoryBytes !== undefined) && (
          <span className="shrink-0 font-mono">
            {container.cpuPercent !== undefined && `${container.cpuPercent.toFixed(1)}%`}
            {container.cpuPercent !== undefined && container.memoryBytes !== undefined && ' · '}
            {container.memoryBytes !== undefined && formatBytes(container.memoryBytes, 0)}
          </span>
        )}
      </div>
    </div>
  );
}
