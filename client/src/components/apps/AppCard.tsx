import React, { useState } from 'react';
import {
  ExternalLink,
  Settings,
  Pin,
  CheckCircle2,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../../types/dashboard';
import { resolveContainerUrl, resolveBookmarkUrl, formatBytes } from '../../lib/utils';

interface AppCardProps {
  item: ContainerItem | CustomAppBookmark;
  isCustomBookmark?: boolean;
  settings?: DashboardSettings;
  onEdit: (item: ContainerItem | CustomAppBookmark) => void;
  onDeleteBookmark?: (id: string) => void;
}

export function AppCard({
  item,
  isCustomBookmark = false,
  settings,
  onEdit,
}: AppCardProps) {
  const [imgError, setImgError] = useState(false);

  const container = !isCustomBookmark ? (item as ContainerItem) : null;
  const bookmark = isCustomBookmark ? (item as CustomAppBookmark) : null;

  const targetUrl = isCustomBookmark && bookmark
    ? resolveBookmarkUrl(bookmark, settings)
    : container
    ? resolveContainerUrl(container, settings)
    : '#';

  const name = container?.displayName || item.name;
  const iconUrl = item.iconUrl;
  const category = item.category || 'General';
  const isPinned = item.pinned;

  const health = container?.health || 'none';
  const state = container?.state || 'running';

  const cpu = container?.cpuPercent;
  const mem = container?.memoryBytes;

  const handleLaunch = () => {
    if (targetUrl && targetUrl !== '#') {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const getCategoryBadgeVariant = (cat: string) => {
    const c = cat.toLowerCase();
    if (c.includes('media')) return 'pastel-sky';
    if (c.includes('download')) return 'pastel-lavender';
    if (c.includes('auto')) return 'pastel-mint';
    if (c.includes('ai') || c.includes('tool')) return 'pastel-amber';
    if (c.includes('sys')) return 'pastel-peach';
    return 'secondary';
  };

  return (
    <div
      onClick={handleLaunch}
      className={`glass-card relative flex flex-col justify-between rounded-2xl p-4 sm:p-5 cursor-pointer group transition-all duration-200 border border-border select-none ${
        isPinned ? 'ring-2 ring-sky-500/20' : ''
      }`}
    >
      {/* Top Bar: Category, Pin, Edit Action */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Badge variant={getCategoryBadgeVariant(category) as any} className="text-[10px] uppercase tracking-wider font-semibold truncate">
            {category}
          </Badge>
          {isPinned && (
            <span title="Pinned to top">
              <Pin className="h-3 w-3 text-sky-500 fill-sky-500/20" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
          {/* Edit Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item);
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Edit icon and launch URL"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          {/* Direct Launch Icon */}
          <div className="p-1.5 rounded-lg text-muted-foreground group-hover:text-sky-600 dark:group-hover:text-sky-400 group-hover:bg-sky-500/10 transition-all">
            <ExternalLink className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>

      {/* Center: App Icon & Name */}
      <div className="flex items-center gap-3.5 my-1">
        <div className="relative flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-border p-2 shadow-inner group-hover:scale-105 transition-transform">
          {iconUrl && !imgError ? (
            <img
              src={iconUrl}
              alt={name}
              onError={() => setImgError(true)}
              className="h-full w-full object-contain filter drop-shadow-sm"
              loading="lazy"
            />
          ) : (
            <span className="text-base font-bold text-sky-600 dark:text-sky-300 uppercase">
              {name.slice(0, 2)}
            </span>
          )}

          {/* Live Health Status Dot */}
          {!isCustomBookmark && (
            <span
              className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background ${
                health === 'healthy'
                  ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                  : health === 'unhealthy'
                  ? 'bg-rose-500 ring-2 ring-rose-500/20'
                  : state === 'running'
                  ? 'bg-sky-500'
                  : 'bg-slate-400'
              }`}
              title={`Health: ${health}, State: ${state}`}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-foreground truncate group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
            {name}
          </h4>
          <p className="text-xs text-muted-foreground truncate font-mono">
            {container?.ports && container.ports.length > 0 ? (
              <span className="text-sky-600 dark:text-sky-400 font-medium">
                :{container.ports.map((p) => p.publicPort || p.privatePort).join(', ')}
              </span>
            ) : bookmark ? (
              <span className="text-muted-foreground">{bookmark.url}</span>
            ) : (
              <span className="text-muted-foreground/70">Internal network</span>
            )}
          </p>
        </div>
      </div>

      {/* Bottom: Stats & Ports Bar */}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
        {!isCustomBookmark && container ? (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            {cpu !== undefined && (
              <span>
                <strong className="text-sky-600 dark:text-sky-400">{cpu.toFixed(1)}%</strong> CPU
              </span>
            )}
            {mem !== undefined && (
              <>
                <span className="text-border">•</span>
                <span>
                  <strong className="text-violet-600 dark:text-violet-400">{formatBytes(mem, 0)}</strong>
                </span>
              </>
            )}
            {cpu === undefined && mem === undefined && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                {container.status}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground truncate">
            {bookmark?.description || 'Custom Web Shortcut'}
          </div>
        )}

        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          Open ↗
        </span>
      </div>
    </div>
  );
}
