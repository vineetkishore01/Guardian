import React, { useState, useEffect, useCallback } from 'react';
import { Cpu, HardDrive, Network, RefreshCw, Search, AlertCircle, ArrowDown, ArrowUp } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Tabs } from '../ui/Tabs';
import { ProcessItem } from '../../types/dashboard';
import { formatBytes, formatRate, cn } from '../../lib/utils';

interface ProcessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSort?: 'cpu' | 'mem' | 'net';
}

export function ProcessModal({
  open,
  onOpenChange,
  initialSort = 'cpu',
}: ProcessModalProps) {
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'net'>(initialSort);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = new URLSearchParams({
        sort: sortBy,
        limit: '40',
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/processes?${query.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setProcesses(Array.isArray(body.processes) ? body.processes : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sortBy, search]);

  useEffect(() => {
    if (open) {
      setLoading(true);
      load();
    }
  }, [open, load]);

  useEffect(() => {
    if (open && initialSort) {
      setSortBy(initialSort);
    }
  }, [open, initialSort]);

  // Live auto-refresh every 3s while open
  useEffect(() => {
    if (!open || !autoRefresh) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        load();
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [open, autoRefresh, load]);

  const query = search.toLowerCase().trim();
  const filtered = query
    ? processes.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.cmd.toLowerCase().includes(query) ||
          p.user.toLowerCase().includes(query) ||
          String(p.pid).includes(query)
      )
    : processes;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Host Processes"
      description="Inspect active host & container processes consuming CPU, Memory, and Network bandwidth."
      maxWidth="2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <label className="flex cursor-pointer select-none items-center gap-2 text-2xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-brand"
            />
            Auto-refresh (3s)
          </label>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <Tabs
            tabs={[
              { id: 'cpu', label: 'Top CPU' },
              { id: 'mem', label: 'Top Memory' },
              { id: 'net', label: 'Top Network' },
            ]}
            activeTab={sortBy}
            onChange={(tab) => setSortBy(tab as 'cpu' | 'mem' | 'net')}
          />

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search processes..."
                className="h-8 w-44 pl-8 text-xs sm:w-56"
              />
            </div>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => {
                setLoading(true);
                load();
              }}
              title="Refresh now"
              aria-label="Refresh process list"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-crit/25 bg-crit-soft/60 px-3 py-2 text-xs text-crit"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Failed to load process telemetry: {error}</span>
          </div>
        )}

        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 text-2xs uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
              <tr>
                <th className="px-3 py-2 font-medium">PID</th>
                <th className="px-3 py-2 font-medium">Process / Command</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 text-right font-medium">
                  <span className="flex items-center justify-end gap-1">
                    <Cpu className="h-3 w-3" /> CPU
                  </span>
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  <span className="flex items-center justify-end gap-1">
                    <HardDrive className="h-3 w-3" /> RAM
                  </span>
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  <span className="flex items-center justify-end gap-1">
                    <Network className="h-3 w-3" /> Network
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.length > 0 ? (
                filtered.map((proc) => {
                  const highCpu = proc.cpuPercent >= 50;
                  const medCpu = proc.cpuPercent >= 15;
                  const highMem = proc.memPercent >= 30;
                  const rx = proc.netRxBytesPerSec || 0;
                  const tx = proc.netTxBytesPerSec || 0;
                  const activeNet = rx > 1024 || tx > 1024;
                  const highNet = rx > 5 * 1024 * 1024 || tx > 5 * 1024 * 1024;

                  return (
                    <tr
                      key={proc.pid}
                      className="transition-colors hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-2xs text-muted-foreground">
                        {proc.pid}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2 sm:max-w-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground truncate">{proc.name}</span>
                        </div>
                        <p
                          className="truncate font-mono text-2xs text-muted-foreground"
                          title={proc.cmd}
                        >
                          {proc.cmd}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-2xs text-muted-foreground">
                        {proc.user}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                        <span
                          className={cn(
                            'tabular font-medium',
                            highCpu ? 'text-crit' : medCpu ? 'text-warn' : 'text-foreground'
                          )}
                        >
                          {proc.cpuPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                        <span
                          className={cn(
                            'tabular font-medium',
                            highMem ? 'text-warn' : 'text-foreground'
                          )}
                        >
                          {formatBytes(proc.memBytes, 0)}
                        </span>
                        <span className="ml-1 text-2xs text-muted-foreground">
                          ({proc.memPercent.toFixed(0)}%)
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                        {activeNet ? (
                          <div className="flex flex-col items-end">
                            <span className={cn('tabular flex items-center gap-0.5 text-2xs font-medium', highNet ? 'text-brand font-semibold' : 'text-foreground')}>
                              <ArrowDown className="h-2.5 w-2.5 text-brand" />
                              {formatRate(rx)}
                            </span>
                            {tx > 1024 && (
                              <span className="tabular flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <ArrowUp className="h-2.5 w-2.5" />
                                {formatRate(tx)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-2xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    {loading ? 'Collecting process statistics…' : 'No matching processes found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}
