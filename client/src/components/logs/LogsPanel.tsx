import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ChevronDown, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Select } from '../ui/Input';
import { LogEntry, LogLevel } from '../../types/dashboard';
import { cn } from '../../lib/utils';

const LEVEL_STYLE: Record<LogLevel, { badge: string; label: string }> = {
  debug: { badge: 'text-muted-foreground border-border bg-muted', label: 'DEBUG' },
  info: { badge: 'text-brand border-brand/20 bg-brand-soft', label: 'INFO' },
  warn: { badge: 'text-warn border-warn/20 bg-warn-soft', label: 'WARN' },
  error: { badge: 'text-crit border-crit/20 bg-crit-soft', label: 'ERROR' },
};

interface LogsResponse {
  entries: LogEntry[];
  total: number;
  counts: Record<LogLevel, number>;
  scopes: string[];
}

export function LogsPanel() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [scope, setScope] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '300' });
      if (level !== 'all') params.set('level', level);
      if (scope !== 'all') params.set('scope', scope);

      const res = await fetch(`/api/logs?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [level, scope]);

  useEffect(() => {
    if (!collapsed) load();
  }, [load, collapsed]);

  useEffect(() => {
    if (collapsed || !autoRefresh) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [collapsed, autoRefresh, load]);

  const problemCount = useMemo(
    () => (data ? data.counts.warn + data.counts.error : 0),
    [data]
  );

  const handleClear = async () => {
    try {
      const res = await fetch('/api/logs', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90'
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">Application logs</h3>
            <p className="truncate text-2xs text-muted-foreground">
              {data
                ? problemCount > 0
                  ? `${data.counts.error} errors · ${data.counts.warn} warnings`
                  : 'No warnings or errors recorded'
                : 'What Guardian itself is doing'}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1.5">
          {data && data.counts.error > 0 && <Badge variant="crit">{data.counts.error}</Badge>}
          {data && data.counts.warn > 0 && <Badge variant="warn">{data.counts.warn}</Badge>}

          {!collapsed && (
            <>
              <Select
                value={level}
                onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
                aria-label="Minimum log level"
              >
                <option value="all">All levels</option>
                <option value="info">Info and above</option>
                <option value="warn">Warnings and above</option>
                <option value="error">Errors only</option>
              </Select>

              {data && data.scopes.length > 0 && (
                <Select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  aria-label="Log scope"
                >
                  <option value="all">All scopes</option>
                  {data.scopes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setAutoRefresh((v) => !v)}
                title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
                aria-pressed={autoRefresh}
                className={autoRefresh ? 'text-brand' : undefined}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>

              <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Clear log buffer">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-[26rem] overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-crit">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {error}
            </div>
          )}

          {data && data.entries.length === 0 && !error && (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No entries match this filter.
            </p>
          )}

          <ul className="divide-y divide-border">
            {data?.entries.map((entry) => {
              const style = LEVEL_STYLE[entry.level];
              const isOpen = expanded.has(entry.id);
              const hasDetail = entry.detail !== undefined && entry.detail !== null;

              return (
                <li key={entry.id} className="px-4 py-2 hover:bg-muted/40">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-px shrink-0 rounded border px-1 py-px font-mono text-[10px] font-medium leading-4',
                        style.badge
                      )}
                    >
                      {style.label}
                    </span>

                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {new Date(entry.t).toLocaleTimeString()}
                    </span>

                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {entry.scope}
                    </span>

                    <span className="min-w-0 flex-1 text-xs text-foreground">
                      {entry.message}
                      {hasDetail && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            })
                          }
                          className="ml-2 text-2xs text-brand hover:underline"
                        >
                          {isOpen ? 'hide detail' : 'detail'}
                        </button>
                      )}
                    </span>
                  </div>

                  {hasDetail && isOpen && (
                    <pre className="mt-1.5 max-h-56 overflow-auto rounded-md border border-border bg-muted/60 p-2 font-mono text-2xs text-muted-foreground">
                      {typeof entry.detail === 'string'
                        ? entry.detail
                        : JSON.stringify(entry.detail, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
