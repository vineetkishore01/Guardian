import React, { useState } from 'react';
import { Trash2, Check, Loader2, AlertCircle, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { DockerSystemDf } from '../../types/dashboard';
import { formatBytes } from '../../lib/utils';

interface PruneAdvisorBannerProps {
  dockerDf?: DockerSystemDf | null;
  onPrune: (scope?: 'dangling' | 'all') => Promise<{ spaceReclaimedBytes: number } | null>;
}

/**
 * Only nag when the button can actually help.
 *
 * The banner used to trigger on total reclaimable space, which counts tagged
 * images and unreferenced volumes — neither of which the prune removes. So it
 * kept asking after a successful prune had already taken everything it could,
 * pointing at space that no available action would ever free.
 */
const DANGLING_THRESHOLD = 512 * 1024 * 1024; // 512 MB of genuinely dead layers

/** Dismissals are remembered per size, so the banner returns if cruft regrows. */
const DISMISS_KEY = 'guardian_prune_dismissed_gb';

export function PruneAdvisorBanner({ dockerDf, onPrune }: PruneAdvisorBannerProps) {
  const [pruning, setPruning] = useState<'dangling' | 'all' | null>(null);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number>(() => {
    const saved = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(saved) ? saved : 0;
  });

  if (!dockerDf) return null;

  const dangling = dockerDf.danglingBytes ?? 0;
  const tagged = dockerDf.unusedTaggedBytes ?? 0;
  const danglingGb = dangling / (1024 * 1024 * 1024);

  const worthShowing = dangling >= DANGLING_THRESHOLD;
  // Re-surface only once there is meaningfully more than when it was dismissed.
  const dismissed = danglingGb <= dismissedAt + 0.5;

  if ((!worthShowing || dismissed) && !result) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(danglingGb));
    setDismissedAt(danglingGb);
    setResult(null);
  };

  const runPrune = async (scope: 'dangling' | 'all') => {
    setPruning(scope);
    setResult(null);
    try {
      const res = await onPrune(scope);
      if (!res) {
        setResult({ tone: 'error', message: 'Cleanup failed. Check the application log.' });
      } else if (res.spaceReclaimedBytes > 0) {
        setResult({ tone: 'ok', message: `Reclaimed ${formatBytes(res.spaceReclaimedBytes)}.` });
      } else {
        setResult({ tone: 'ok', message: 'Nothing left to remove.' });
      }
    } catch {
      setResult({ tone: 'error', message: 'Cleanup failed. Check the application log.' });
    } finally {
      setPruning(null);
    }
  };

  return (
    <div
      id="docker-cleanup"
      className="flex flex-col gap-3 rounded-lg border border-warn/25 bg-warn-soft/60 p-3.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {formatBytes(dangling)} of unused Docker layers can be removed
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {dockerDf.danglingCount} dangling image
            {dockerDf.danglingCount === 1 ? '' : 's'} left behind by rebuilds. Running containers
            and tagged images are untouched.
            {tagged > 0 && (
              <>
                {' '}A further <strong className="font-medium text-foreground">
                  {formatBytes(tagged)}
                </strong>{' '}
                sits in {dockerDf.unusedTaggedCount} tagged image
                {dockerDf.unusedTaggedCount === 1 ? '' : 's'} that no container uses — removing
                those means re-pulling them.
              </>
            )}
          </p>
          {result && (
            <p
              className={`mt-1 flex items-center gap-1 text-2xs font-medium ${
                result.tone === 'ok' ? 'text-ok' : 'text-crit'
              }`}
              role="status"
            >
              {result.tone === 'ok' ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
              )}
              {result.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={() => runPrune('dangling')}
          disabled={pruning !== null}
        >
          {pruning === 'dangling' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Pruning…
            </>
          ) : (
            `Remove ${formatBytes(dangling)}`
          )}
        </Button>

        {tagged > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => runPrune('all')}
            disabled={pruning !== null}
            title={`Also remove ${formatBytes(tagged)} of tagged images no container uses. They will be re-pulled when next needed.`}
          >
            {pruning === 'all' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Pruning…
              </>
            ) : (
              'Include unused tags'
            )}
          </Button>
        )}

        <button
          type="button"
          onClick={dismiss}
          title="Dismiss until more accumulates"
          aria-label="Dismiss cleanup notice"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
