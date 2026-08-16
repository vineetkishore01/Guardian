import React from 'react';
import { cn, severityFor, severityBarClass } from '../../lib/utils';

interface CoreStripProps {
  cores: number[];
  className?: string;
}

/**
 * One bar per logical CPU.
 *
 * The collector has always returned per-core utilisation and the dashboard
 * never drew it, so a single pegged thread stayed hidden inside a calm average —
 * exactly the shape of a single-threaded bottleneck. Eight quiet bars and one
 * full bar tell a completely different story from "12%".
 */
export function CoreStrip({ cores, className }: CoreStripProps) {
  if (!cores || cores.length === 0) return null;

  const busiest = Math.max(...cores);

  return (
    <div
      className={cn('flex items-end gap-[3px]', className)}
      role="img"
      aria-label={`Per-core utilisation, busiest core ${busiest.toFixed(0)}%`}
      title={cores.map((c, i) => `core ${i}: ${c.toFixed(0)}%`).join('\n')}
    >
      {cores.map((value, i) => {
        const clamped = Math.max(0, Math.min(100, value));
        return (
          <span key={i} className="relative flex h-6 w-full min-w-[3px] flex-1 items-end rounded-sm bg-muted">
            <span
              className={cn('w-full rounded-sm transition-[height] duration-500', severityBarClass(severityFor(clamped, 75, 90)))}
              style={{ height: `${Math.max(6, clamped)}%` }}
            />
          </span>
        );
      })}
    </div>
  );
}
