import React, { useState } from 'react';
import { RefreshCw, Grid3x3, LayoutGrid, Search } from 'lucide-react';
import { PhysicalDisk } from '../../types/dashboard';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { DiskDetailCard } from './DiskDetailCard';
import { DriveBaySummary } from './DriveBaySummary';
import { DiskDetailModal } from './DiskDetailModal';

interface DiskSmartSectionProps {
  disks?: PhysicalDisk[];
  onRefresh?: () => Promise<void> | void;
  className?: string;
}

type DriveView = 'compact' | 'cards';

const VIEW_STORAGE_KEY = 'guardian_drive_view';

function readStoredView(): DriveView | null {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return raw === 'compact' || raw === 'cards' ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredView(view: DriveView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // ignore (e.g. Safari private mode)
  }
}

export function DiskSmartSection({ disks = [], onRefresh, className }: DiskSmartSectionProps) {
  const [expandedDisk, setExpandedDisk] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<DriveView>(
    () => readStoredView() ?? (disks.length > 4 ? 'compact' : 'cards')
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [inspectDevice, setInspectDevice] = useState<string | null>(null);

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

  if (!disks || disks.length === 0) {
    return null;
  }

  const criticalDrives = disks.filter((d) => d.health === 'critical').length;
  const warningDrives = disks.filter((d) => d.health === 'warning').length;

  const setViewMode = (next: DriveView) => {
    setView(next);
    writeStoredView(next);
  };

  return (
    <div className={cn('space-y-3.5', className)}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <h3 className="section-label">Physical Disks &amp; S.M.A.R.T. Health</h3>
          <span className="font-mono text-2xs text-muted-foreground">
            ({disks.length} physical drive{disks.length === 1 ? '' : 's'})
          </span>
          {criticalDrives > 0 ? (
            <Badge variant="crit" className="font-mono text-2xs">
              {criticalDrives} failing
            </Badge>
          ) : warningDrives > 0 ? (
            <Badge variant="warn" className="font-mono text-2xs">
              {warningDrives} warning
            </Badge>
          ) : (
            <Badge variant="ok" className="font-mono text-2xs">
              All Drives Healthy
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              aria-pressed={view === 'compact'}
              title="Compact drive bay view"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === 'compact'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Grid3x3 className="h-3 w-3" />
              Compact
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-pressed={view === 'cards'}
              title="Full detail card view"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === 'cards'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutGrid className="h-3 w-3" />
              Cards
            </button>
          </div>

          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setInspectDevice(null);
              setModalOpen(true);
            }}
            className="font-mono text-2xs h-7 gap-1.5"
          >
            <Search className="h-3 w-3" />
            Inspect Drives ({disks.length})
          </Button>

          <Button
            variant="outline"
            size="xs"
            onClick={handleRefresh}
            disabled={refreshing}
            className="font-mono text-2xs h-7 gap-1.5"
            title="Force refresh SMART telemetry from host block devices"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            {refreshing ? 'Scanning...' : 'Refresh S.M.A.R.T.'}
          </Button>
        </div>
      </div>

      {view === 'compact' ? (
        <DriveBaySummary
          disks={disks}
          onInspect={(device) => {
            setInspectDevice(device);
            setModalOpen(true);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
          {disks.map((disk) => (
            <DiskDetailCard
              key={disk.device}
              disk={disk}
              expanded={expandedDisk === disk.device}
              onToggleExpand={() => setExpandedDisk(expandedDisk === disk.device ? null : disk.device)}
            />
          ))}
        </div>
      )}

      <DiskDetailModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        disks={disks}
        initialDevice={inspectDevice}
        onRefresh={onRefresh}
      />
    </div>
  );
}
