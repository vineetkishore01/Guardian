import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, ArrowDownToLine, RotateCcw, Loader2 } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { cn } from '../../lib/utils';

interface ContainerLogLine {
  stream: 'stdout' | 'stderr';
  timestamp: string | null;
  message: string;
}

interface ContainerLogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containerId: string;
  containerName: string;
  onRestartContainer?: (id: string) => Promise<boolean | void>;
}

const TAIL_OPTIONS = [100, 200, 500, 1000];

export function ContainerLogsModal({
  open,
  onOpenChange,
  containerId,
  containerName,
  onRestartContainer,
}: ContainerLogsModalProps) {
  const [lines, setLines] = useState<ContainerLogLine[]>([]);
  const [tail, setTail] = useState(200);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/containers/${encodeURIComponent(containerId)}/logs?tail=${tail}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setLines(Array.isArray(body.lines) ? body.lines : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [containerId, tail]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Poll while following. Docker's log endpoint is cheap for a bounded tail.
  useEffect(() => {
    if (!open || !follow) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [open, follow, load]);

  // Stick to the newest output while following.
  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const query = filter.toLowerCase().trim();
  const visible = query
    ? lines.filter((l) => l.message.toLowerCase().includes(query))
    : lines;

  const errorCount = lines.filter((l) => l.stream === 'stderr').length;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Logs — ${containerName}`}
      description={
        errorCount > 0
          ? `${lines.length} lines · ${errorCount} on stderr`
          : `${lines.length} lines from stdout and stderr`
      }
      maxWidth="2xl"
      footer={
        <>
          <label className="mr-auto flex cursor-pointer select-none items-center gap-2 text-2xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showTimestamps}
              onChange={(e) => setShowTimestamps(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-brand"
            />
            Timestamps
          </label>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter lines"
          aria-label="Filter log lines"
          className="h-8 flex-1 min-w-[8rem]"
        />

        <Select value={tail} onChange={(e) => setTail(Number(e.target.value))} aria-label="Lines to fetch">
          {TAIL_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Last {n}
            </option>
          ))}
        </Select>

        <Button
          variant={follow ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setFollow((f) => !f)}
          title={follow ? 'Following — click to pause' : 'Paused — click to follow'}
          aria-pressed={follow}
        >
          <ArrowDownToLine className={cn('h-3.5 w-3.5', follow && 'text-brand')} />
          {follow ? 'Following' : 'Paused'}
        </Button>

        {onRestartContainer && (
          <Button
            variant="outline"
            size="sm"
            disabled={restarting}
            onClick={async () => {
              setRestarting(true);
              try {
                await onRestartContainer(containerId);
                load();
              } finally {
                setRestarting(false);
              }
            }}
            title="Restart container"
            aria-label="Restart container"
          >
            {restarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-warn" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 text-xs">Restart</span>
          </Button>
        )}

        <Button variant="outline" size="icon-sm" onClick={load} title="Refresh" aria-label="Refresh logs">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-crit/25 bg-crit-soft/60 px-3 py-2.5 text-xs"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-crit" aria-hidden="true" />
          <div>
            <p className="text-foreground">Could not read logs: {error}</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Guardian needs access to the Docker socket to read container logs.
            </p>
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={(e) => {
            // Scrolling away from the bottom pauses follow, as a terminal would.
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            if (!atBottom && follow) setFollow(false);
          }}
          className="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg border border-border bg-muted/40 p-2.5"
        >
          {visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {loading ? 'Loading…' : query ? `No lines match “${filter}”.` : 'No output.'}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed">
              {visible.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'px-1',
                    // stderr is marked with a rule and colour, plus the stream is
                    // named in the title — never colour alone.
                    line.stream === 'stderr' &&
                      'border-l-2 border-crit/50 bg-crit-soft/40 text-crit'
                  )}
                  title={line.stream}
                >
                  {showTimestamps && line.timestamp && (
                    <span className="mr-2 text-muted-foreground">
                      {new Date(line.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                  <span className={line.stream === 'stderr' ? '' : 'text-foreground'}>
                    {line.message}
                  </span>
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </Dialog>
  );
}
