import { useState } from 'react';
import { Link2, Link2Off, Download, Trash2, ChevronDown, Info } from 'lucide-react';
import { ReclaimReport } from '../../types/dashboard';
import { formatBytes, cn } from '../../lib/utils';

interface Props {
  report?: ReclaimReport;
}

/** Entries shown before the list collapses. */
const COLLAPSED_LIMIT = 6;

/**
 * What is on the download volume, and what the download client still wants.
 *
 * Report-only, deliberately and permanently. There is no delete button and the
 * volume is mounted read-only, because getting "safe to reclaim" wrong by a
 * single entry means destroying something that took a week to acquire. This
 * points; the operator decides.
 */
export function ReclaimPanel({ report }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Nothing until the first slow scan lands, or if there is no download client.
  if (!report) return null;

  const { entries, reclaimableBytes, reclaimableCount, totalBytes } = report;
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_LIMIT);
  const hidden = entries.length - shown.length;

  /*
   * Only finished downloads can say anything about linking. Counting an
   * in-progress grab as "not linked" would report every healthy download as a
   * problem, which is exactly the sort of false alarm that gets a panel ignored.
   */
  const { finishedFiles, finishedLinkedFiles, finishedUnlinkedBytes } = report;
  const linkingKnown = finishedFiles > 0;
  const linkingHealthy = linkingKnown && finishedLinkedFiles === finishedFiles;
  const duplicating = linkingKnown && finishedLinkedFiles === 0;

  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-foreground">Downloads</h3>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {formatBytes(totalBytes)} across {entries.length} folder
            {entries.length === 1 ? '' : 's'} · checked against {report.source}
          </p>
        </div>

        <div className="text-right">
          <div
            className={cn(
              'font-mono text-lg font-semibold leading-none',
              reclaimableBytes > 0 ? 'text-warn' : 'text-muted-foreground'
            )}
          >
            {formatBytes(reclaimableBytes)}
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">
            {reclaimableCount === 0
              ? 'nothing orphaned'
              : `orphaned in ${reclaimableCount} folder${reclaimableCount === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {/* The hard link signal. On one filesystem an import should link rather
          than copy, so this is where a silently-reverted mount shows up. */}
      {linkingKnown && (
        <div
          className={cn(
            'mt-3 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-2xs',
            duplicating ? 'border-warn/35 bg-warn-soft/40' : 'border-border bg-muted/40'
          )}
        >
          {linkingHealthy ? (
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
          ) : (
            <Link2Off
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', duplicating ? 'text-warn' : 'text-muted-foreground')}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            <span className={cn('font-medium', duplicating ? 'text-warn' : 'text-foreground')}>
              {finishedLinkedFiles} of {finishedFiles} completed file
              {finishedFiles === 1 ? '' : 's'} hard-linked
            </span>
            <p className="mt-0.5 text-muted-foreground">
              {linkingHealthy
                ? 'Imports share storage with the library, so these downloads cost nothing extra.'
                : duplicating
                  ? `Imports are copying rather than linking — about ${formatBytes(finishedUnlinkedBytes)} is stored twice.`
                  : 'Some imports share storage with the library; the rest are stored twice.'}
            </p>
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-1">
        {shown.map((e) => (
          <li
            key={e.path}
            className="flex items-center gap-2 rounded px-1 py-1 text-2xs odd:bg-muted/25"
          >
            {e.reclaimable ? (
              <Trash2 className="h-3 w-3 shrink-0 text-warn" aria-hidden="true" />
            ) : (
              <Download className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}

            <span
              className={cn('min-w-0 flex-1 truncate', e.reclaimable ? 'text-foreground' : 'text-muted-foreground')}
              title={e.path}
            >
              {e.name}
            </span>

            {e.linkedFiles > 0 && (
              <Link2
                className="h-3 w-3 shrink-0 text-ok"
                aria-label="hard-linked into a library"
              />
            )}

            <span className="shrink-0 font-mono text-muted-foreground">
              {e.torrentState ?? (e.reclaimable ? 'not in client' : '')}
            </span>
            <span
              className={cn(
                'w-16 shrink-0 text-right font-mono',
                e.reclaimable ? 'font-semibold text-warn' : 'text-muted-foreground'
              )}
            >
              {formatBytes(e.bytes)}
            </span>
          </li>
        ))}
      </ul>

      {entries.length > COLLAPSED_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : `Show all ${entries.length}`}
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
      {hidden > 0 && !expanded && (
        <span className="ml-2 text-2xs text-muted-foreground">and {hidden} more</span>
      )}

      <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-2.5 text-2xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          Orphaned means the download client no longer tracks it. Guardian only reports — it mounts
          this volume read-only and never deletes anything.
        </span>
      </p>
    </div>
  );
}
