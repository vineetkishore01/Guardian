import React, { useState } from 'react';
import {
  Globe,
  Zap,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Eye,
  EyeOff,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  History,
  Copy,
  Check,
} from 'lucide-react';
import { WanTelemetry, SpeedtestProgress, SpeedtestResult } from '../../types/dashboard';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

interface NetworkHealthCardProps {
  wan?: WanTelemetry;
  speedtestHistory?: SpeedtestResult[];
  onRunSpeedtest: () => Promise<SpeedtestResult>;
  onRefreshWan?: () => Promise<void>;
}

export function NetworkHealthCard({
  wan,
  speedtestHistory = [],
  onRunSpeedtest,
  onRefreshWan,
}: NetworkHealthCardProps) {
  const [showIp, setShowIp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshingWan, setRefreshingWan] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<SpeedtestProgress | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const lastTest = speedtestHistory[0];

  const handleCopyIp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wan?.publicIp) {
      navigator.clipboard.writeText(wan.publicIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /*
   * Progress is polled, not inferred.
   *
   * This used to set one static value -- 10%, phase "ping" -- and then await
   * the whole test, so the bar sat frozen at a tenth of its width for the full
   * run and vanished on completion. It read as a hang. The server was already
   * measuring real per-phase progress from actual bytes and elapsed time; it
   * simply had no route to serve it and nothing asking.
   */
  const pollRef = React.useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // A test outliving its card would otherwise keep polling forever.
  React.useEffect(() => stopPolling, []);

  const handleStartSpeedtest = async () => {
    if (testing) return;
    setTesting(true);
    setTestError(null);
    setCurrentProgress({ phase: 'ping', currentMbps: 0, progressPercent: 5 });

    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch('/api/speedtest/progress');
        if (!res.ok) return;
        const { progress } = (await res.json()) as { progress: SpeedtestProgress | null };
        if (!progress) return;

        /*
         * The resolved promise is what marks the end, not the polled phase.
         * The server keeps the last test's final state until the next one
         * starts, so a poll landing early can return a stale "complete" and
         * snap the bar to 100% before this run has measured anything.
         */
        if (progress.phase === 'complete' || progress.phase === 'error') return;
        setCurrentProgress(progress);
      } catch {
        // Transient; the next tick retries. A failed poll must never fail the
        // test that is still running perfectly well underneath it.
      }
    }, 450);

    try {
      await onRunSpeedtest();
    } catch (err) {
      setTestError((err as Error).message || 'Speedtest failed');
    } finally {
      stopPolling();
      setTesting(false);
      setCurrentProgress(null);
    }
  };

  const handleRefreshWan = async () => {
    if (refreshingWan || !onRefreshWan) return;
    setRefreshingWan(true);
    try {
      await onRefreshWan();
    } finally {
      setRefreshingWan(false);
    }
  };

  const maskedIp = wan?.publicIp
    ? wan.publicIp.replace(/^(\d+\.\d+)\..*$/, '$1.•••.•••')
    : '—';

  return (
    <div className="surface overflow-hidden rounded-xl border border-border bg-card p-4 transition-all">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: WAN & ISP Status */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Globe className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">Internet & WAN Health</h4>
              {wan?.countryCode && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-mono font-medium text-muted-foreground uppercase">
                  {wan.countryCode} {wan.city ? `· ${wan.city}` : ''}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {wan?.isp ? wan.isp : 'Network Gateway Connected'}
            </p>
          </div>
        </div>

        {/* Right: IP, Ping & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {wan?.publicIp && (
            <div className="flex items-center gap-1 rounded-md border border-border/80 bg-muted/60 px-2 py-1 text-2xs font-mono text-foreground">
              <span className="text-muted-foreground">IP:</span>
              <span>{showIp ? wan.publicIp : maskedIp}</span>
              <button
                type="button"
                onClick={() => setShowIp(!showIp)}
                className="ml-1 text-muted-foreground hover:text-foreground"
                title={showIp ? 'Hide IP' : 'Show IP'}
              >
                {showIp ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={handleCopyIp}
                className="text-muted-foreground hover:text-foreground"
                title="Copy IP"
              >
                {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}

          {wan?.pingMs !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-mono font-medium',
                wan.pingMs < 30 ? 'bg-ok-soft text-ok' : wan.pingMs < 80 ? 'bg-warn-soft text-warn' : 'bg-muted text-muted-foreground'
              )}
              title="WAN Gateway Round-Trip Latency"
            >
              <Activity className="h-3 w-3" />
              {wan.pingMs} ms
            </span>
          )}

          {onRefreshWan && (
            <Button
              variant="outline"
              size="xs"
              disabled={refreshingWan}
              onClick={handleRefreshWan}
              title="Refresh WAN status"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn('h-3 w-3', refreshingWan && 'animate-spin')} />
            </Button>
          )}

          <Button
            variant="brand"
            size="xs"
            disabled={testing}
            onClick={handleStartSpeedtest}
            className="h-7 gap-1 px-3 text-2xs shadow-sm font-medium"
          >
            <Zap className={cn('h-3 w-3', testing && 'animate-pulse text-amber-300')} />
            {testing ? 'Testing…' : 'Run Speedtest'}
          </Button>
        </div>
      </div>

      {/* Active Speedtest Progress Banner */}
      {testing && currentProgress && (
        <div className="mt-4 rounded-lg border border-brand/40 bg-brand-soft/40 p-3.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-brand flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 animate-bounce" />
              {currentProgress.phase === 'ping' && 'Measuring Latency & Jitter…'}
              {currentProgress.phase === 'download' && 'Testing Download Speed…'}
              {currentProgress.phase === 'upload' && 'Testing Upload Speed…'}
              {currentProgress.phase === 'complete' && 'Test Complete!'}
            </span>
            <span className="font-mono text-sm font-bold text-foreground">
              {currentProgress.currentMbps > 0 ? `${currentProgress.currentMbps.toFixed(1)} Mbps` : '—'}
            </span>
          </div>

          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-brand via-cyan-400 to-brand-strong transition-all duration-300"
              style={{ width: `${currentProgress.progressPercent}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground font-mono">
            <span>Ping: {currentProgress.pingMs ? `${currentProgress.pingMs} ms` : '…'}</span>
            <span>
              Download:{' '}
              {currentProgress.downloadMbps ? `${currentProgress.downloadMbps} Mbps` : 'Testing…'}
            </span>
          </div>
        </div>
      )}

      {testError && (
        <div className="mt-3 flex items-center gap-1.5 text-2xs text-crit" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {testError}
        </div>
      )}

      {/* Last Benchmark Summary */}
      {!testing && lastTest && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-ok-soft text-ok">
                <ArrowDown className="h-3 w-3" />
              </div>
              <div>
                <span className="text-2xs text-muted-foreground block leading-none">Download</span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {lastTest.downloadMbps.toFixed(1)} <span className="text-2xs font-normal">Mbps</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-brand-soft text-brand">
                <ArrowUp className="h-3 w-3" />
              </div>
              <div>
                <span className="text-2xs text-muted-foreground block leading-none">Upload</span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {lastTest.uploadMbps.toFixed(1)} <span className="text-2xs font-normal">Mbps</span>
                </span>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground">
                <Activity className="h-3 w-3" />
              </div>
              <div>
                <span className="text-2xs text-muted-foreground block leading-none">Ping</span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {lastTest.pingMs} <span className="text-2xs font-normal">ms</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(lastTest.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>

            {speedtestHistory.length > 1 && (
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-brand hover:underline"
              >
                <History className="h-2.5 w-2.5" />
                {showHistory ? 'Hide history' : `${speedtestHistory.length} benchmarks`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Historical Benchmarks Drawer */}
      {showHistory && speedtestHistory.length > 1 && (
        <div className="mt-3 max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border bg-muted/40 p-2 text-2xs font-mono">
          {speedtestHistory.map((test) => (
            <div key={test.id} className="flex items-center justify-between py-1 px-2 hover:bg-card rounded">
              <span className="text-muted-foreground">
                {new Date(test.timestamp).toLocaleDateString()} {new Date(test.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-ok">↓ {test.downloadMbps.toFixed(1)} Mbps</span>
                <span className="text-brand">↑ {test.uploadMbps.toFixed(1)} Mbps</span>
                <span className="text-muted-foreground">{test.pingMs} ms</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
