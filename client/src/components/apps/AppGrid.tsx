import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, LayoutGrid, Plus, X, AlertTriangle, Check } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { AppCard } from './AppCard';
import { EditAppModal } from './EditAppModal';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../../types/dashboard';
import { containerSeverity, severityRank, cn } from '../../lib/utils';

interface AppGridProps {
  containers?: ContainerItem[];
  customApps?: CustomAppBookmark[];
  settings?: DashboardSettings;
  loading?: boolean;
  onSaveContainer: (name: string, updates: Partial<ContainerItem>) => Promise<boolean>;
  onSaveBookmark: (bookmark: CustomAppBookmark) => Promise<boolean>;
  onDeleteBookmark: (id: string) => Promise<boolean>;
  onOpenAddApp: () => void;
  onViewLogs?: (container: ContainerItem) => void;
}

type SortKey = 'default' | 'name' | 'cpu' | 'mem';

/** Containers needing attention, for the summary line and the default order. */
function needsAttention(item: ContainerItem | CustomAppBookmark, isBookmark: boolean): boolean {
  return !isBookmark && containerSeverity(item as ContainerItem) !== 'ok';
}

const PREFERRED_CATEGORY_ORDER = [
  'Media',
  'Downloads',
  'Automation',
  'Productivity',
  'Development',
  'AI & Tools',
  'System',
  'Utilities',
];

export function AppGrid({
  containers = [],
  customApps = [],
  settings,
  loading = false,
  onSaveContainer,
  onSaveBookmark,
  onDeleteBookmark,
  onOpenAddApp,
  onViewLogs,
}: AppGridProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const [editingItem, setEditingItem] = useState<{
    item: ContainerItem | CustomAppBookmark;
    isCustomBookmark: boolean;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search; Escape inside the field clears and blurs it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingContext =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      if (e.key === '/' && !isTypingContext && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const allItems = useMemo(
    () => [
      ...containers.filter((c) => !c.hidden).map((c) => ({ item: c as ContainerItem | CustomAppBookmark, isCustomBookmark: false })),
      ...customApps.map((b) => ({ item: b as ContainerItem | CustomAppBookmark, isCustomBookmark: true })),
    ],
    [containers, customApps]
  );

  const hiddenCount = useMemo(() => containers.filter((c) => c.hidden).length, [containers]);

  const attentionCount = useMemo(
    () => containers.filter((c) => !c.hidden && containerSeverity(c) !== 'ok').length,
    [containers]
  );

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    let pinnedCount = 0;

    for (const { item } of allItems) {
      if (item.pinned) pinnedCount += 1;
      const cat = item.category || 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    }

    const tabs = [{ id: 'all', label: 'All', count: allItems.length }];
    if (pinnedCount > 0) tabs.push({ id: 'pinned', label: 'Pinned', count: pinnedCount });

    const known = PREFERRED_CATEGORY_ORDER.filter((c) => counts[c]);
    const rest = Object.keys(counts)
      .filter((c) => !PREFERRED_CATEGORY_ORDER.includes(c))
      .sort((a, b) => a.localeCompare(b));

    for (const cat of [...known, ...rest]) {
      tabs.push({ id: cat, label: cat, count: counts[cat] });
    }
    return tabs;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return allItems
      .filter(({ item }) => {
        if (selectedCategory === 'pinned') {
          if (!item.pinned) return false;
        } else if (selectedCategory !== 'all') {
          if ((item.category || 'General') !== selectedCategory) return false;
        }

        if (!q) return true;

        const container = item as ContainerItem;
        const haystack = [
          item.name,
          container.displayName,
          item.category,
          (item as CustomAppBookmark).description,
          container.image,
          ...(container.ports?.map((p) => String(p.publicPort || p.privatePort)) ?? []),
        ];

        return haystack.some((field) => field && String(field).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        // Anything broken outranks everything, including pins: a dashboard that
        // buries a dead container between two healthy ones is not monitoring.
        const aRank = a.isCustomBookmark ? 2 : severityRank(containerSeverity(a.item as ContainerItem));
        const bRank = b.isCustomBookmark ? 2 : severityRank(containerSeverity(b.item as ContainerItem));
        if (aRank !== bRank) return aRank - bRank;

        // Pinned items lead among equals.
        if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;

        switch (sortBy) {
          case 'name':
            return (a.item.name || '').localeCompare(b.item.name || '');
          case 'cpu':
            return (
              ((b.item as ContainerItem).cpuPercent || 0) -
              ((a.item as ContainerItem).cpuPercent || 0)
            );
          case 'mem':
            return (
              ((b.item as ContainerItem).memoryBytes || 0) -
              ((a.item as ContainerItem).memoryBytes || 0)
            );
          default:
            return (a.item.name || '').localeCompare(b.item.name || '');
        }
      });
  }, [allItems, selectedCategory, searchQuery, sortBy]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <Tabs tabs={categories} activeTab={selectedCategory} onChange={setSelectedCategory} />

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative flex-1 lg:w-60">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search apps"
              aria-label="Search applications"
              className="h-8 pl-8 pr-8"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 font-mono text-2xs text-muted-foreground sm:block">
                /
              </kbd>
            )}
          </div>

          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Sort applications"
          >
            <option value="default">Name</option>
            <option value="name">Name (A–Z)</option>
            <option value="cpu">CPU usage</option>
            <option value="mem">Memory usage</option>
          </Select>
        </div>
      </div>

      {!loading && containers.length > 0 && (
        <p
          className={cn(
            'flex items-center gap-1.5 text-2xs',
            attentionCount > 0 ? 'text-warn' : 'text-muted-foreground'
          )}
          role="status"
        >
          {attentionCount > 0 ? (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {attentionCount} container{attentionCount === 1 ? '' : 's'} need
              {attentionCount === 1 ? 's' : ''} attention — shown first
            </>
          ) : (
            <>
              <Check className="h-3 w-3 shrink-0 text-ok" aria-hidden="true" />
              All containers healthy
            </>
          )}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="surface p-3.5">
              <div className="flex items-start gap-3">
                <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-2/3" />
                  <div className="skeleton h-2.5 w-1/2" />
                </div>
              </div>
              <div className="mt-4 skeleton h-2.5 w-full" />
            </div>
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map(({ item, isCustomBookmark }) => (
            <AppCard
              key={
                isCustomBookmark
                  ? `bookmark:${(item as CustomAppBookmark).id}`
                  : `container:${(item as ContainerItem).id}`
              }
              item={item}
              isCustomBookmark={isCustomBookmark}
              settings={settings}
              onEdit={(target) => setEditingItem({ item: target, isCustomBookmark })}
              onDeleteBookmark={onDeleteBookmark}
              onViewLogs={onViewLogs}
            />
          ))}
        </div>
      ) : (
        <div className="surface flex flex-col items-center px-6 py-12 text-center">
          <LayoutGrid className="h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
          <h4 className="mt-3 text-sm font-medium text-foreground">
            {searchQuery ? 'No matches' : 'Nothing here yet'}
          </h4>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {searchQuery
              ? `Nothing matches “${searchQuery}”.`
              : 'Containers appear automatically. Add a bookmark for anything outside Docker.'}
          </p>
          <div className="mt-4 flex items-center gap-2">
            {searchQuery && (
              <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                Clear search
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onOpenAddApp}>
              <Plus className="h-3.5 w-3.5" />
              Add bookmark
            </Button>
          </div>
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="text-2xs text-muted-foreground">
          {hiddenCount} container{hiddenCount === 1 ? '' : 's'} hidden from this view.
        </p>
      )}

      {editingItem && (
        <EditAppModal
          open
          onOpenChange={(open) => !open && setEditingItem(null)}
          item={editingItem.item}
          isCustomBookmark={editingItem.isCustomBookmark}
          onSaveContainer={onSaveContainer}
          onSaveBookmark={onSaveBookmark}
        />
      )}
    </div>
  );
}
