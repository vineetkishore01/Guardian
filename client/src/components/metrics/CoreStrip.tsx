import React, { useState } from 'react';
import { cn } from '../../lib/utils';

interface CoreStripProps {
  cores: number[];
  className?: string;
}

/**
 * Modern multi-thread CPU visualizer.
 * Renders an equalizer-inspired core distribution strip with interactive tooltips,
 * smooth load gradients, and core bottleneck detection.
 */
export function CoreStrip({ cores, className }: CoreStripProps) {
  const [hoveredCore, setHoveredCore] = useState<number | null>(null);

  if (!cores || cores.length === 0) return null;

  const busiestIndex = cores.reduce(
    (maxIdx, curr, idx, arr) => (curr > arr[maxIdx] ? idx : maxIdx),
    0
  );
  const busiestValue = cores[busiestIndex] || 0;

  return (
    <div className={cn('space-y-1', className)}>
      <div
        className="flex h-7 w-full items-end gap-1 rounded-md border border-border/50 bg-muted/40 p-1 backdrop-blur-xs"
        role="img"
        aria-label={`CPU thread utilization, busiest thread ${busiestValue.toFixed(0)}%`}
      >
        {cores.map((value, i) => {
          const clamped = Math.max(0, Math.min(100, value));
          const isPegged = clamped >= 85;
          const isWarm = clamped >= 55 && !isPegged;
          const isHovered = hoveredCore === i;

          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredCore(i)}
              onMouseLeave={() => setHoveredCore(null)}
              className="group/core relative flex h-full min-w-[4px] flex-1 items-end justify-center rounded-[2px] bg-muted/80 transition-all hover:bg-muted"
            >
              {/* Tooltip on hover */}
              {isHovered && (
                <div className="pointer-events-none absolute -top-8 z-30 flex -translate-x-1/2 flex-col items-center whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground shadow-md ring-1 ring-border">
                  <span>
                    T{i}: <strong className="font-mono">{clamped.toFixed(0)}%</strong>
                  </span>
                  <div className="absolute -bottom-1 h-1.5 w-1.5 rotate-45 bg-popover ring-1 ring-border" />
                </div>
              )}

              {/* Vertical fill bar */}
              <div
                className={cn(
                  'w-full rounded-[2px] transition-[height,opacity] duration-500 ease-out',
                  isPegged
                    ? 'bg-gradient-to-t from-crit to-rose-400 shadow-[0_0_6px_rgba(239,68,68,0.45)]'
                    : isWarm
                    ? 'bg-gradient-to-t from-warn to-amber-300'
                    : 'bg-gradient-to-t from-brand/90 to-cyan-400/90',
                  isHovered && 'brightness-125 ring-1 ring-foreground/20'
                )}
                style={{ height: `${Math.max(8, clamped)}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Micro legend / peak alert when a thread is bottlenecked */}
      <div className="flex items-center justify-between px-0.5 text-[10px] text-muted-foreground">
        <span className="font-mono text-2xs">
          {hoveredCore !== null ? (
            <span className="text-foreground">
              Thread {hoveredCore}: <strong className="font-mono">{cores[hoveredCore].toFixed(0)}%</strong>
            </span>
          ) : (
            `${cores.length} threads`
          )}
        </span>

        {busiestValue >= 80 && (
          <span className="font-mono text-2xs text-crit font-medium">
            Peak T{busiestIndex}: {busiestValue.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
