import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Cpu, HardDrive, Box, Globe } from 'lucide-react';
import { Problem } from '../../types/dashboard';
import { cn } from '../../lib/utils';

interface Props {
  problems?: Problem[];
}

/*
 * The one place that answers "is anything wrong?".
 *
 * Everything here was already on the page somewhere -- a red border on a card, an
 * amber figure in a gauge, a count line above the app grid. What was missing was
 * a single surface that collects them, so noticing a problem did not depend on
 * scrolling to the right section and reading its colour. Nothing previously said
 * "CPU is pegged and /mnt/nas is nearly full" in one sentence.
 *
 * When there is nothing wrong it collapses to one quiet green line rather than
 * disappearing: "no problems" is information, and a surface that vanishes cannot
 * be distinguished from one that is broken.
 */

const SCOPE_ICON = {
  host: Cpu,
  disk: HardDrive,
  container: Box,
  probe: Globe,
} as const;

/** Above this the strip summarises rather than listing everything. */
const COLLAPSED_LIMIT = 4;

export function ProblemsStrip({ problems }: Props) {
  const [expanded, setExpanded] = useState(false);

  // `undefined` means the server has not reported yet; an empty array means it
  // looked and found nothing. Only the latter is worth an all-clear.
  if (!problems) return null;

  const crit = problems.filter((p) => p.severity === 'crit');
  const warn = problems.filter((p) => p.severity === 'warn');

  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok-soft/40 px-3 py-2 text-xs text-ok">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">All clear</span>
        <span className="text-muted-foreground">
          No host, storage, container or endpoint issues.
        </span>
      </div>
    );
  }

  const worst = crit.length > 0 ? 'crit' : 'warn';
  const shown = expanded ? problems : problems.slice(0, COLLAPSED_LIMIT);
  const hidden = problems.length - shown.length;

  const summary = [
    crit.length > 0 ? `${crit.length} critical` : null,
    warn.length > 0 ? `${warn.length} warning${warn.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      aria-label="Needs attention"
      className={cn(
        'rounded-lg border px-3 py-2.5',
        worst === 'crit' ? 'border-crit/40 bg-crit-soft/40' : 'border-warn/35 bg-warn-soft/40'
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle
          className={cn('h-3.5 w-3.5 shrink-0', worst === 'crit' ? 'text-crit' : 'text-warn')}
          aria-hidden="true"
        />
        <span
          className={cn('text-xs font-semibold', worst === 'crit' ? 'text-crit' : 'text-warn')}
        >
          Needs attention
        </span>
        <span className="text-2xs text-muted-foreground">{summary}</span>

        {problems.length > COLLAPSED_LIMIT && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : `Show all ${problems.length}`}
            <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>

      <ul className="mt-2 space-y-1">
        {shown.map((p) => {
          const Icon = SCOPE_ICON[p.scope] ?? AlertTriangle;
          return (
            <li key={p.id} className="flex items-baseline gap-2 text-2xs">
              <Icon
                className={cn(
                  'h-3 w-3 shrink-0 translate-y-0.5',
                  p.severity === 'crit' ? 'text-crit' : 'text-warn'
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'shrink-0 font-medium',
                  p.severity === 'crit' ? 'text-crit' : 'text-warn'
                )}
              >
                {p.label}
              </span>
              <span className="truncate text-muted-foreground" title={p.detail}>
                {p.detail}
              </span>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <p className="mt-1.5 text-2xs text-muted-foreground">and {hidden} more.</p>
      )}
    </section>
  );
}
