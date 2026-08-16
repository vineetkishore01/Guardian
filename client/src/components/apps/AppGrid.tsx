import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Layers,
  Plus,
  X,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { AppCard } from './AppCard';
import { EditAppModal } from './EditAppModal';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../../types/dashboard';

interface AppGridProps {
  containers?: ContainerItem[];
  customApps?: CustomAppBookmark[];
  settings?: DashboardSettings;
  onSaveContainer: (name: string, updates: Partial<ContainerItem>) => Promise<boolean>;
  onSaveBookmark: (bookmark: CustomAppBookmark) => Promise<boolean>;
  onDeleteBookmark: (id: string) => Promise<boolean>;
  onOpenAddApp: () => void;
}

export function AppGrid({
  containers = [],
  customApps = [],
  settings,
  onSaveContainer,
  onSaveBookmark,
  onDeleteBookmark,
  onOpenAddApp,
}: AppGridProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'default' | 'name' | 'cpu' | 'mem'>('default');
  const [editingItem, setEditingItem] = useState<{
    item: ContainerItem | CustomAppBookmark;
    isCustomBookmark: boolean;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global '/' keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Combine containers and custom bookmarks
  const allItems = useMemo(() => {
    const visibleContainers = containers.filter((c) => !c.hidden);
    const containerEntries = visibleContainers.map((c) => ({
      item: c,
      isCustomBookmark: false,
    }));
    const bookmarkEntries = customApps.map((b) => ({
      item: b,
      isCustomBookmark: true,
    }));

    return [...containerEntries, ...bookmarkEntries];
  }, [containers, customApps]);

  // Extract available categories & counts
  const categories = useMemo(() => {
    const map: Record<string, number> = { all: allItems.length };
    let pinnedCount = 0;

    for (const { item } of allItems) {
      if (item.pinned) pinnedCount++;
      const cat = item.category || 'General';
      map[cat] = (map[cat] || 0) + 1;
    }

    const tabs = [{ id: 'all', label: 'All', count: allItems.length }];
    if (pinnedCount > 0) {
      tabs.push({ id: 'pinned', label: 'Pinned', count: pinnedCount });
    }

    const standardCats = ['Media', 'Downloads', 'Automation', 'Productivity', 'AI & Tools', 'System', 'Development', 'Utilities'];
    for (const cat of standardCats) {
      if (map[cat]) {
        tabs.push({ id: cat, label: cat, count: map[cat] });
      }
    }

    for (const [cat, count] of Object.entries(map)) {
      if (cat !== 'all' && !standardCats.includes(cat) && !tabs.find((t) => t.id === cat)) {
        tabs.push({ id: cat, label: cat, count });
      }
    }

    return tabs;
  }, [allItems]);

  // Filter & sort items
  const filteredItems = useMemo(() => {
    return allItems
      .filter(({ item }) => {
        if (selectedCategory === 'pinned' && !item.pinned) return false;
        if (selectedCategory !== 'all' && selectedCategory !== 'pinned') {
          if ((item.category || 'General') !== selectedCategory) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const nameMatch = (item.name || '').toLowerCase().includes(q);
          const catMatch = (item.category || '').toLowerCase().includes(q);
          const descMatch = ((item as CustomAppBookmark).description || '').toLowerCase().includes(q);
          const portMatch =
            (item as ContainerItem).ports?.some(
              (p) => String(p.publicPort || p.privatePort).includes(q)
            ) ?? false;

          if (!nameMatch && !catMatch && !descMatch && !portMatch) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (a.item.pinned && !b.item.pinned) return -1;
        if (!a.item.pinned && b.item.pinned) return 1;

        if (sortBy === 'name') {
          return (a.item.name || '').localeCompare(b.item.name || '');
        }
        if (sortBy === 'cpu') {
          const cpuA = (a.item as ContainerItem).cpuPercent || 0;
          const cpuB = (b.item as ContainerItem).cpuPercent || 0;
          return cpuB - cpuA;
        }
        if (sortBy === 'mem') {
          const memA = (a.item as ContainerItem).memoryBytes || 0;
          const memB = (b.item as ContainerItem).memoryBytes || 0;
          return memB - memA;
        }

        return 0;
      });
  }, [allItems, selectedCategory, searchQuery, sortBy]);

  return (
    <div className="space-y-3.5">
      {/* Category Tabs & Controls Header */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Category Tabs */}
        <div className="overflow-x-auto">
          <Tabs
            tabs={categories}
            activeTab={selectedCategory}
            onChange={setSelectedCategory}
          />
        </div>

        {/* Search & Sort Controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps... (/)"
              className="pl-8 pr-7 h-8 text-xs bg-background"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-medium cursor-pointer shadow-sm"
          >
            <option value="default">Sort: Default</option>
            <option value="name">Sort: Name</option>
            <option value="cpu">Sort: CPU %</option>
            <option value="mem">Sort: RAM Usage</option>
          </select>
        </div>
      </div>

      {/* Grid of Apps */}
      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredItems.map(({ item, isCustomBookmark }) => (
            <AppCard
              key={isCustomBookmark ? (item as CustomAppBookmark).id : (item as ContainerItem).id}
              item={item}
              isCustomBookmark={isCustomBookmark}
              settings={settings}
              onEdit={(target) =>
                setEditingItem({
                  item: target,
                  isCustomBookmark,
                })
              }
              onDeleteBookmark={onDeleteBookmark}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
          <Layers className="h-9 w-9 text-muted-foreground mx-auto mb-2.5 opacity-60" />
          <h4 className="text-sm font-semibold text-foreground">No applications found</h4>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-3.5">
            {searchQuery
              ? `No apps matching "${searchQuery}". Try a different search term or category.`
              : 'No applications in this category yet.'}
          </p>
          <Button variant="secondary" size="sm" onClick={onOpenAddApp} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Custom Bookmark
          </Button>
        </div>
      )}

      {/* Edit Container / App Modal */}
      {editingItem && (
        <EditAppModal
          open={!!editingItem}
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
