import React, { useState } from 'react';
import { Trash2, Check, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { DockerSystemDf } from '../../types/dashboard';
import { formatBytes } from '../../lib/utils';

interface PruneAdvisorBannerProps {
  dockerDf?: DockerSystemDf | null;
  onPrune: () => Promise<{ spaceReclaimedBytes: number } | null>;
}

const RECLAIM_THRESHOLD = 1024 * 1024 * 1024; // 1 GB

export function PruneAdvisorBanner({ dockerDf, onPrune }: PruneAdvisorBannerProps) {
  const [pruning, setPruning] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  if (!dockerDf || dockerDf.reclaimableTotalBytes < RECLAIM_THRESHOLD) return null;

  const unusedImages = Math.max(0, dockerDf.imagesTotal - dockerDf.imagesActive);

  const handlePrune = async () => {
    setPruning(true);
    setResult(null);
    try {
      const res = await onPrune();
      if (!res) {
        setResult({ tone: 'error', message: 'Cleanup failed. Check the server logs.' });
      } else if (res.spaceReclaimedBytes > 0) {
        setResult({ tone: 'ok', message: `Reclaimed ${formatBytes(res.spaceReclaimedBytes)}.` });
      } else {
        setResult({ tone: 'ok', message: 'Nothing to remove — no dangling layers.' });
      }
    } catch {
      setResult({ tone: 'error', message: 'Cleanup failed. Check the server logs.' });
    } finally {
      setPruning(false);
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
            {formatBytes(dockerDf.reclaimableTotalBytes)} of Docker storage can be reclaimed
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {unusedImages > 0
              ? `${unusedImages} unused image${unusedImages === 1 ? '' : 's'}`
              : 'Dangling layers'}
            {dockerDf.volumesReclaimable > 0 &&
              ` · ${formatBytes(dockerDf.volumesReclaimable)} in unreferenced volumes`}
            . Pruning removes dangling images only; running containers are untouched.
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

      <Button
        variant="outline"
        size="sm"
        onClick={handlePrune}
        disabled={pruning}
        className="shrink-0 self-start sm:self-auto"
      >
        {pruning ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Pruning…
          </>
        ) : (
          'Prune unused images'
        )}
      </Button>
    </div>
  );
}
