import React, { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Tabs, TabItem } from '../ui/Tabs';
import { PhysicalDisk } from '../../types/dashboard';
import { cn, formatBytes } from '../../lib/utils';
import { DiskDetailCard } from './DiskDetailCard';
import { getDriveIcon, getMediaBucket, driveShortName } from './diskPresentation';

interface DiskDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disks: PhysicalDisk[];
  /** Device selected from the dashboard chip; selects that drive on open. */
  initialDevice?: string | null;
  onRefresh?: () => Promise<void> | void;
}

type FilterTab = 'all' | 'attention' | 'nvme' | 'ssd' | 'hdd';

const HEALTH_DOT_CLASS: Record<PhysicalDisk['health'], string> = {
  passed: 'bg-ok',
  warning: 'bg-warn',
  critical: 'bg-crit',
  unknown: 'bg-muted-foreground',
};

const HEALTH_LABEL: Record<PhysicalDisk['health'], string> = {
  passed: 'Passed',
  warning: 'Warning',
  critical: 'Failing',
  unknown: 'Unknown',
};

export function DiskDetailModal({
  open,
  onOpenChange,
  disks,
  initialDevice,
  onRefresh,
}: DiskDetailModalProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Seed selection whenever the modal opens.
  useEffect(() => {
    if (open) {
      setSelected(initialDevice ?? disks[0]?.device ?? null);
    }
    // Only re-seed on the open transition, not on every disks/initialDevice change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return disks;
    return disks.filter((d) =>
      [d.device, d.name, d.model, d.vendor, d.serial]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(query))
    );
  }, [disks, search]);

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { all: searched.length, attention: 0, nvme: 0, ssd: 0, hdd: 0 };
    for (const d of searched) {
      if (d.health === 'warning' || d.health === 'critical') c.attention += 1;
      c[getMediaBucket(d)] += 1;
    }
    return c;
  }, [searched]);

  const tabs: TabItem[] = useMemo(() => {
    const defs: { id: FilterTab; label: string }[] = [
      { id: 'all', label: 'All' },
      { id: 'attention', label: 'Needs Attention' },
      { id: 'nvme', label: 'NVMe' },
      { id: 'ssd', label: 'SSD' },
      { id: 'hdd', label: 'HDD' },
    ];
    return defs
      .filter((t) => t.id === 'all' || counts[t.id] > 0)
      .map((t) => ({ id: t.id, label: t.label, count: counts[t.id] }));
  }, [counts]);

  const visible = useMemo(() => {
    if (tab === 'all') return searched;
    if (tab === 'attention') return searched.filter((d) => d.health === 'warning' || d.health === 'critical');
    return searched.filter((d) => getMediaBucket(d) === tab);
  }, [searched, tab]);

  // If the current selection has been filtered out, fall back to the first visible drive.
  useEffect(() => {
    if (visible.length === 0) return;
    if (!visible.some((d) => d.device === selected)) {
      setSelected(visible[0].device);
    }
  }, [visible, selected]);

  /*
   * Falls back to the first visible drive rather than null: the seeding and
   * filter-fallback effects run after commit, so deriving it here avoids a frame
   * of "No drives match" while state catches up.
   */
  const selectedDisk = visible.find((d) => d.device === selected) ?? visible[0] ?? null;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        await fetch('/api/disks/smart/refresh', { method: 'POST' });
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const criticalCount = disks.filter((d) => d.health === 'critical').length;
  const warningCount = disks.filter((d) => d.health === 'warning').length;
  const aggregateHealth =
    criticalCount > 0
      ? `${criticalCount} failing`
      : warningCount > 0
        ? `${warningCount} warning`
        : 'all healthy';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Hardware S.M.A.R.T. Explorer"
      description="Inspect physical drive health, endurance, mapped volumes, and full S.M.A.R.T. attribute tables."
      maxWidth="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="font-mono text-2xs text-muted-foreground">
            {visible.length} of {disks.length} drive{disks.length === 1 ? '' : 's'} · {aggregateHealth}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="font-mono text-2xs gap-1.5"
            >
              <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
              {refreshing ? 'Scanning...' : 'Refresh S.M.A.R.T.'}
            </Button>
            <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2.5 bg-card pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drives..."
              className="h-8 w-44 pl-8 text-xs sm:w-56"
            />
          </div>
          <Tabs tabs={tabs} activeTab={tab} onChange={(id) => setTab(id as FilterTab)} />
        </div>

        <div className="grid gap-3 md:grid-cols-[13rem_1fr]">
          <div className="no-scrollbar flex gap-2 overflow-x-auto md:block md:max-h-[60vh] md:space-y-1.5 md:overflow-y-auto md:overflow-x-hidden md:pr-1">
            {visible.map((disk) => {
              const isSelected = disk.device === selectedDisk?.device;
              const healthLabel = HEALTH_LABEL[disk.health] ?? 'Unknown';
              return (
                <button
                  key={disk.device}
                  type="button"
                  onClick={() => setSelected(disk.device)}
                  title={`${disk.model} · ${disk.device} · ${healthLabel}`}
                  className={cn(
                    'w-40 shrink-0 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left transition-colors md:w-full',
                    'hover:border-brand/40 hover:bg-accent',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'border-brand/60 bg-brand-soft/20'
                  )}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {getDriveIcon(disk, 'h-3.5 w-3.5')}
                    <span className="truncate font-mono text-2xs font-semibold text-foreground">
                      {driveShortName(disk)}
                    </span>
                    <span
                      className={cn('ml-auto h-2 w-2 shrink-0 rounded-full', HEALTH_DOT_CLASS[disk.health])}
                      role="img"
                      title={`Health: ${healthLabel}`}
                      aria-label={`Health: ${healthLabel}`}
                    />
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-3xs text-muted-foreground">
                    {formatBytes(disk.sizeBytes)}
                    {disk.tempC !== undefined && ` · ${disk.tempC}°C`}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {selectedDisk ? (
              <DiskDetailCard disk={selectedDisk} expanded alwaysExpanded onToggleExpand={() => {}} />
            ) : (
              <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                No drives match this filter.
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
