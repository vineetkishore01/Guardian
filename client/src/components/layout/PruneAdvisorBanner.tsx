import React, { useState } from 'react';
import { Trash2, AlertTriangle, Sparkles, CheckCircle2, RefreshCw } from 'lucide-react';
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
    <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-slate-900/80 to-slate-900/60 p-4 sm:p-5 backdrop-blur-md shadow-lg shadow-amber-950/20 relative overflow-hidden">
      <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 mt-0.5">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-amber-200">
                Docker Storage Optimization Advisor
              </h3>
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/40">
                {dockerDf.reclaimableFormatted} Reclaimable
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
              Found <strong className="text-amber-200">{dockerDf.imagesTotal - dockerDf.imagesActive} unused images</strong> consuming valuable root storage. Pruning dangling layers will immediately free disk space.
            </p>
            {reclaimedMsg && (
              <p className="text-xs text-emerald-400 font-medium mt-1.5 flex items-center gap-1">
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
            className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold shadow-md shadow-amber-950/40 w-full sm:w-auto"
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
