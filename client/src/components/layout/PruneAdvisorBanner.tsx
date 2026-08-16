import React, { useState } from 'react';
import { Trash2, Sparkles, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { DockerSystemDf } from '../../types/dashboard';
import { formatBytes } from '../../lib/utils';

interface PruneAdvisorBannerProps {
  dockerDf?: DockerSystemDf | null;
  onPrune: () => Promise<{ spaceReclaimedBytes: number } | null>;
}

export function PruneAdvisorBanner({ dockerDf, onPrune }: PruneAdvisorBannerProps) {
  const [pruning, setPruning] = useState(false);
  const [reclaimedMsg, setReclaimedMsg] = useState<string | null>(null);

  if (!dockerDf || dockerDf.reclaimableTotalBytes < 1024 * 1024 * 1024) {
    return null;
  }

  const handlePrune = async () => {
    setPruning(true);
    setReclaimedMsg(null);
    try {
      const res = await onPrune();
      if (res && res.spaceReclaimedBytes > 0) {
        setReclaimedMsg(`Successfully reclaimed ${formatBytes(res.spaceReclaimedBytes)}!`);
      } else {
        setReclaimedMsg('No dangling images needed cleanup.');
      }
    } catch {
      setReclaimedMsg('Cleanup failed, check logs.');
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 backdrop-blur-sm shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mt-0.5">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Docker Storage Optimization Advisor
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 rounded-full border border-amber-500/30">
                {dockerDf.reclaimableFormatted} Reclaimable
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Found <strong className="text-foreground">{dockerDf.imagesTotal - dockerDf.imagesActive} unused images</strong> consuming storage space. Pruning dangling layers will immediately free disk capacity.
            </p>
            {reclaimedMsg && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {reclaimedMsg}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Button
            variant="default"
            size="sm"
            onClick={handlePrune}
            disabled={pruning}
            className="w-full sm:w-auto"
          >
            {pruning ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Pruning...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Prune Unused Images
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
