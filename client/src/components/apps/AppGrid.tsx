import React, { useState, useMemo } from 'react';
import {
  Search,
  LayoutGrid,
  List,
  Pin,
  Sparkles,
  Layers,
  ArrowUpDown,
  Filter,
  Plus,
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

    const tabs = [{ id: 'all', label: 'All Apps', count: allItems.length }];
    if (pinnedCount > 0) {
      tabs.push({ id: 'pinned', label: 'Pinned', count: pinnedCount });
    }

    const standardCats = ['Media', 'Downloads', 'Automation', 'Productivity', 'AI & Tools', 'System', 'Development', 'Utilities'];
    for (const cat of standardCats) {
      if (map[cat]) {
        tabs.push({ id: cat, label: cat, count: map[cat] });
      }
    }

    // Any other custom categories
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
        // Category filter
        if (selectedCategory === 'pinned' && !item.pinned) return false;
        if (selectedCategory !== 'all' && selectedCategory !== 'pinned') {
          if ((item.category || 'General') !== selectedCategory) return false;
        }

        // Search query
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
        // Pinned always first
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
    <div className="space-y-4">
      {/* Category Tabs & Controls Header */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Category Tabs */}
        <div className="flex-1 overflow-x-auto">
          <Tabs
            tabs={categories}
            activeTab={selectedCategory}
            onChange={setSelectedCategory}
          />
        </div>

        {/* Search & Sort Controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1 sm:w-48">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps, ports..."
              className="pl-8 h-8 text-xs bg-slate-900/80 border-white/10"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-8 rounded-lg border border-white/10 bg-slate-900/80 px-2.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-medium cursor-pointer"
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4">
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
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-12 text-center backdrop-blur-sm">
          <Layers className="h-10 w-10 text-slate-500 mx-auto mb-3" />
          <h4 className="text-base font-bold text-slate-200">No applications found</h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
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
