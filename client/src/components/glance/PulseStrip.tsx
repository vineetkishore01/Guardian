import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { DockerSystemDf, HostTelemetry, Problem } from '../../types/dashboard';
import { Verdict, isPruneWorthwhile } from '../../lib/glance';
import { cn, formatBytes } from '../../lib/utils';

interface PulseStripProps {
  verdict: Verdict;
  problems?: Problem[];
  host?: HostTelemetry;
  dockerDf?: DockerSystemDf | null;
  syntheticSources: string[];
  onPrune: (scope?: 'dangling' | 'all') => Promise<{ spaceReclaimedBytes: number } | null>;
}

const LEVEL_DOT: Record<Verdict['level'], string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  sample: 'bg-muted-foreground',
};

const LEVEL_LEAD: Record<Verdict['level'], string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
  sample: 'text-foreground',
};

type PruneUi =
  | { step: 'idle' }
  | { step: 'confirm' }
  | { step: 'running'; scope: 'dangling' | 'all' }
  | { step: 'done'; tone: 'ok' | 'error'; message: string };

const chipBase =
  'inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-2xs leading-none transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The one-sentence answer to "is anything wrong?", plus the few actions that
 * follow from it. Replaces three stacked banners: issues and prune are chips
 * here, and details open in place instead of pushing the page down.
 */
export function PulseStrip({ verdict, problems, host, dockerDf, syntheticSources, onPrune }: PulseStripProps) {
  const [showIssues, setShowIssues] = useState(false);
  const [prune, setPrune] = useState<PruneUi>({ step: 'idle' });

  // A result message is a receipt, not a fixture.
  useEffect(() => {
    if (prune.step !== 'done') return;
    const t = window.setTimeout(() => setPrune({ step: 'idle' }), 8000);
    return () => window.clearTimeout(t);
  }, [prune]);

  const issueCount = problems?.length ?? 0;
  const issueWorst = problems?.some((p) => p.severity === 'crit') ? 'crit' : 'warn';
  const dangling = dockerDf?.danglingBytes ?? 0;
  const tagged = dockerDf?.unusedTaggedBytes ?? 0;
  const pruneAvailable = isPruneWorthwhile(dockerDf);
  const showPruneRow = prune.step !== 'idle';

  const runPrune = async (scope: 'dangling' | 'all') => {
    setPrune({ step: 'running', scope });
    try {
      const res = await onPrune(scope);
      if (!res) setPrune({ step: 'done', tone: 'error', message: 'Cleanup failed. Check the application log.' });
      else if (res.spaceReclaimedBytes > 0)
        setPrune({ step: 'done', tone: 'ok', message: `Reclaimed ${formatBytes(res.spaceReclaimedBytes)}.` });
      else setPrune({ step: 'done', tone: 'ok', message: 'Nothing left to remove.' });
    } catch {
      setPrune({ step: 'done', tone: 'error', message: 'Cleanup failed. Check the application log.' });
    }
  };

  const sorted = [...(problems ?? [])].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'crit' ? -1 : 1
  );

  return (
    <section aria-label="Server status" className="surface">
      <div className="flex flex-col gap-2.5 px-4 py-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
        <div className="flex min-w-0 items-start gap-2.5" role="status" aria-live="polite">
          <span
            className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[verdict.level])}
            aria-hidden="true"
          />
          <p className="min-w-0 text-sm leading-6 text-muted-foreground">
            <span className={cn('font-semibold', LEVEL_LEAD[verdict.level])}>{verdict.lead}</span>
            {verdict.lead && verdict.body ? ': ' : ''}
            <span className="text-foreground/90">{verdict.body}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-[18px] lg:pl-0">
          {issueCount > 0 && (
            <button
              type="button"
              onClick={() => setShowIssues((v) => !v)}
              aria-expanded={showIssues}
              className={cn(
                chipBase,
                issueWorst === 'crit'
                  ? 'border-crit/40 bg-crit-soft text-crit hover:border-crit/60'
                  : 'border-warn/40 bg-warn-soft text-warn hover:border-warn/60'
              )}
              title="Show what needs attention"
            >
              {issueCount} {issueCount === 1 ? 'Issue' : 'Issues'}
              <ChevronDown className={cn('h-3 w-3 transition-transform', showIssues && 'rotate-180')} aria-hidden="true" />
            </button>
          )}

          {host?.rebootRequired && (
            <span
              className={cn(chipBase, 'border-warn/40 bg-warn-soft text-warn')}
              title={
                host.rebootRequiredPackages?.length
                  ? `A reboot is pending. Requested by: ${host.rebootRequiredPackages.join(', ')}`
                  : 'The distro flagged a pending reboot (kernel or core library update).'
              }
            >
              <RotateCw className="h-3 w-3" aria-hidden="true" />
              Reboot required
            </span>
          )}

          {pruneAvailable && prune.step === 'idle' && (
            <button
              type="button"
              onClick={() => setPrune({ step: 'confirm' })}
              className={cn(chipBase, 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground')}
              title="Remove unused Docker layers left behind by rebuilds"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              Prune {formatBytes(dangling)}
            </button>
          )}

          {syntheticSources.length > 0 && (
            <span
              className={cn(chipBase, 'border-border text-muted-foreground')}
              title={
                (syntheticSources.includes('Docker') ? 'Mount /var/run/docker.sock to read live containers. ' : '') +
                (syntheticSources.includes('host') ? 'Host metrics need /proc and /sys from a Linux host.' : '')
              }
            >
              Sample {syntheticSources.join(' + ')}
            </span>
          )}
        </div>
      </div>

      {showPruneRow && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-2xs" role="status">
          {prune.step === 'confirm' && (
            <>
              <span className="text-muted-foreground">
                Remove{' '}
                <span className="font-mono text-foreground">{formatBytes(dangling)}</span> of dangling image layers? Running
                containers and tagged images are untouched.
              </span>
              <button
                type="button"
                onClick={() => runPrune('dangling')}
                className={cn(chipBase, 'border-foreground/30 text-foreground hover:bg-accent')}
              >
                Remove {formatBytes(dangling)}
              </button>
              {tagged > 0 && (
                <button
                  type="button"
                  onClick={() => runPrune('all')}
                  className={cn(chipBase, 'border-border text-muted-foreground hover:text-foreground')}
                  title="Also removes tagged images no container uses. They are re-pulled when next needed."
                >
                  + unused tags {formatBytes(tagged)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPrune({ step: 'idle' })}
                className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </>
          )}
          {prune.step === 'running' && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Pruning…
            </span>
          )}
          {prune.step === 'done' && (
            <span className={cn('flex items-center gap-1.5 font-medium', prune.tone === 'ok' ? 'text-ok' : 'text-crit')}>
              {prune.tone === 'ok' ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
              )}
              {prune.message}
            </span>
          )}
        </div>
      )}

      {showIssues && sorted.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-border px-4 py-2.5">
          {sorted.map((p) => (
            <li key={p.id} className="flex items-baseline gap-2 text-2xs">
              <span
                className={cn('h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full', p.severity === 'crit' ? 'bg-crit' : 'bg-warn')}
                aria-hidden="true"
              />
              <span className={cn('shrink-0 font-medium', p.severity === 'crit' ? 'text-crit' : 'text-warn')}>
                {p.label}
              </span>
              <span className="truncate text-muted-foreground" title={p.detail}>
                {p.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
