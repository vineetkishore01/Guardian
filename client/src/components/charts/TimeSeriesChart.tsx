import React, { useId, useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '../../lib/utils';

export interface ChartSeries {
  id: string;
  label: string;
  points: Array<{ t: number; v: number }>;
  /** Series colour. Defaults to the slot-1 token. */
  color?: string;
}

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  height?: number;
  /** Formats a value for the axis and tooltip. */
  formatValue?: (v: number) => string;
  /** Fixes the y domain. Omit either bound to derive it from the data. */
  yMin?: number;
  yMax?: number;
  /** Gaps longer than this break the line instead of interpolating across. */
  gapMs?: number;
  className?: string;
  emptyMessage?: string;
}

interface Layout {
  width: number;
  height: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
}

const DEFAULT_COLORS = [
  'var(--viz-1)',
  'var(--viz-2)',
  'var(--viz-3)',
  'var(--viz-4)',
];

/** Measures the container so the chart can be fluid without a layout library. */
function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** "Nice" axis ticks — rounded to 1/2/5 × 10ⁿ so labels read cleanly. */
function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;

  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

/*
 * Measures label width with a canvas rather than guessing from character count.
 * A per-character estimate is wrong by enough to matter: "488.3 KB/s" measures
 * ~7.4px/char at 10px, not the ~5.6px a digits-only guess suggests, and the
 * difference silently clipped the axis.
 */
let measureCtx: CanvasRenderingContext2D | null = null;

/** Empirical width of one tabular figure at the 10px tick size. */
const TABULAR_CHAR_PX = 7.6;

function measureLabel(text: string): number {
  // The ticks render with `tabular-nums`, whose advance width is wider than the
  // proportional figures a canvas reports. Take whichever estimate is larger so
  // the gutter is never undersized.
  const tabularEstimate = text.length * TABULAR_CHAR_PX;

  if (typeof document === 'undefined') return tabularEstimate;
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
      measureCtx.font = `10px ${family}`;
    }
  }
  if (!measureCtx) return tabularEstimate;

  return Math.max(measureCtx.measureText(text).width, tabularEstimate);
}

function formatTimeTick(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 36 * 3600_000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function TimeSeriesChart({
  series,
  height = 260,
  formatValue = (v) => String(Math.round(v * 10) / 10),
  yMin,
  yMax,
  gapMs,
  className,
  emptyMessage = 'No data for this range yet.',
}: TimeSeriesChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const gradientId = useId();
  const clipId = useId();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const plotH = Math.max(0, height - 12 - 26);

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length === 0) return null;

    const tMin = Math.min(...all.map((p) => p.t));
    const tMax = Math.max(...all.map((p) => p.t));
    const values = all.map((p) => p.v);

    let lo = yMin ?? Math.min(...values);
    let hi = yMax ?? Math.max(...values);

    if (lo === hi) {
      // A perfectly flat series still deserves a readable band.
      lo = yMin ?? lo - 1;
      hi = yMax ?? hi + 1;
    } else if (yMax === undefined) {
      hi += (hi - lo) * 0.08; // headroom so the peak is not clipped by the frame
    }

    return { tMin, tMax: tMax === tMin ? tMin + 1 : tMax, lo, hi };
  }, [series, yMin, yMax]);

  /*
   * Left padding is measured, not guessed.
   *
   * A fixed gutter silently truncated wide tick labels: a throughput axis
   * formats as "976.6 KB/s", which overflowed a 46px gutter and rendered as
   * "6.6 KB/s" — an axis off by two orders of magnitude, which is far worse
   * than an ugly one.
   */
  const yTicks = useMemo(
    () => (model ? niceTicks(model.lo, model.hi, 4) : []),
    [model]
  );

  const layout: Layout = useMemo(() => {
    const widest = yTicks.reduce((max, t) => Math.max(max, measureLabel(formatValue(t))), 0);
    // Measured text width, plus the 8px label gap and a little slack.
    const gutter = Math.min(120, Math.max(34, Math.ceil(widest) + 14));
    return {
      width: Math.max(width, 0),
      height,
      padTop: 12,
      padRight: 12,
      padBottom: 26,
      padLeft: gutter,
    };
  }, [yTicks, formatValue, width, height]);

  const plotW = Math.max(0, layout.width - layout.padLeft - layout.padRight);

  const scaleX = useCallback(
    (t: number) => {
      if (!model) return 0;
      return layout.padLeft + ((t - model.tMin) / (model.tMax - model.tMin)) * plotW;
    },
    [model, layout.padLeft, plotW]
  );

  const scaleY = useCallback(
    (v: number) => {
      if (!model) return 0;
      const clamped = Math.max(model.lo, Math.min(model.hi, v));
      return layout.padTop + plotH - ((clamped - model.lo) / (model.hi - model.lo)) * plotH;
    },
    [model, layout.padTop, plotH]
  );

  /* Split each series wherever the sample gap exceeds the expected cadence, so
     an outage reads as a break rather than a straight line across it. */
  const segmented = useMemo(() => {
    if (!model) return [];
    return series.map((s, idx) => {
      const sorted = [...s.points].sort((a, b) => a.t - b.t);
      const threshold =
        gapMs ??
        (() => {
          if (sorted.length < 3) return Infinity;
          const deltas = sorted.slice(1).map((p, i) => p.t - sorted[i].t);
          const median = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
          return Math.max(median * 3, 60_000);
        })();

      const segments: Array<Array<{ t: number; v: number }>> = [];
      let current: Array<{ t: number; v: number }> = [];
      for (let i = 0; i < sorted.length; i += 1) {
        if (i > 0 && sorted[i].t - sorted[i - 1].t > threshold) {
          if (current.length) segments.push(current);
          current = [];
        }
        current.push(sorted[i]);
      }
      if (current.length) segments.push(current);

      return {
        ...s,
        color: s.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
        sorted,
        segments,
      };
    });
  }, [series, model, gapMs]);

  const xTicks = model
    ? niceTicks(model.tMin, model.tMax, Math.max(2, Math.min(6, Math.floor(plotW / 110))))
        .filter((t) => t >= model.tMin && t <= model.tMax)
    : [];

  /* Nearest sample per series to the cursor, for the crosshair readout. */
  const hover = useMemo(() => {
    if (hoverX === null || !model || segmented.length === 0) return null;
    const t = model.tMin + ((hoverX - layout.padLeft) / plotW) * (model.tMax - model.tMin);

    const readings = segmented
      .map((s) => {
        let best: { t: number; v: number } | null = null;
        let bestDist = Infinity;
        for (const p of s.sorted) {
          const d = Math.abs(p.t - t);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        }
        return best ? { id: s.id, label: s.label, color: s.color, point: best, dist: bestDist } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (readings.length === 0) return null;
    const anchor = readings.reduce((a, b) => (a.dist <= b.dist ? a : b));
    return { readings, anchorT: anchor.point.t };
  }, [hoverX, model, segmented, layout.padLeft, plotW]);

  const handlePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverX(x >= layout.padLeft && x <= layout.padLeft + plotW ? x : null);
  };

  const showLegend = series.length > 1;

  return (
    <div className={cn('w-full', className)}>
      {showLegend && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {segmented.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div ref={containerRef} className="relative w-full" style={{ height }}>
        {!model || plotW <= 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {width > 0 ? emptyMessage : null}
          </div>
        ) : (
          <>
            <svg
              width={layout.width}
              height={layout.height}
              role="img"
              aria-label={`${series.map((s) => s.label).join(', ')} over time`}
              onPointerMove={handlePointer}
              onPointerLeave={() => setHoverX(null)}
              className="touch-none"
            >
              <defs>
                <clipPath id={clipId}>
                  <rect x={layout.padLeft} y={layout.padTop} width={plotW} height={plotH} />
                </clipPath>
                {segmented.map((s) => (
                  <linearGradient
                    key={s.id}
                    id={`${gradientId}-${s.id}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    {/* Soft pastel wash under the line; the line itself keeps
                        full chroma so it stays legible. */}
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
                  </linearGradient>
                ))}
              </defs>

              {/* Recessive horizontal grid */}
              {yTicks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={layout.padLeft}
                    x2={layout.padLeft + plotW}
                    y1={scaleY(tick)}
                    y2={scaleY(tick)}
                    stroke="hsl(var(--viz-grid))"
                    strokeWidth={1}
                  />
                  <text
                    x={layout.padLeft - 8}
                    y={scaleY(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={10}
                    fill="hsl(var(--viz-axis))"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatValue(tick)}
                  </text>
                </g>
              ))}

              {/* Time axis */}
              {xTicks.map((tick) => (
                <text
                  key={tick}
                  x={scaleX(tick)}
                  y={layout.height - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="hsl(var(--viz-axis))"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatTimeTick(tick, model.tMax - model.tMin)}
                </text>
              ))}

              <g clipPath={`url(#${clipId})`}>
                {segmented.map((s) =>
                  s.segments.map((segment, i) => {
                    if (segment.length === 0) return null;
                    const line = segment
                      .map((p, j) => `${j === 0 ? 'M' : 'L'} ${scaleX(p.t)} ${scaleY(p.v)}`)
                      .join(' ');
                    const baseY = layout.padTop + plotH;
                    const area = `${line} L ${scaleX(segment[segment.length - 1].t)} ${baseY} L ${scaleX(
                      segment[0].t
                    )} ${baseY} Z`;

                    return (
                      <g key={`${s.id}-${i}`}>
                        {/* Only fill under a single series; stacked washes muddy. */}
                        {series.length === 1 && (
                          <path d={area} fill={`url(#${gradientId}-${s.id})`} />
                        )}
                        <path
                          d={line}
                          fill="none"
                          stroke={s.color}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {/* A lone reading would otherwise be invisible. */}
                        {segment.length === 1 && (
                          <circle
                            cx={scaleX(segment[0].t)}
                            cy={scaleY(segment[0].v)}
                            r={2.5}
                            fill={s.color}
                          />
                        )}
                      </g>
                    );
                  })
                )}
              </g>

              {/* Crosshair */}
              {hover && (
                <g pointerEvents="none">
                  <line
                    x1={scaleX(hover.anchorT)}
                    x2={scaleX(hover.anchorT)}
                    y1={layout.padTop}
                    y2={layout.padTop + plotH}
                    stroke="hsl(var(--viz-axis))"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  {hover.readings.map((r) => (
                    <circle
                      key={r.id}
                      cx={scaleX(r.point.t)}
                      cy={scaleY(r.point.v)}
                      r={4}
                      fill={r.color}
                      // 2px surface ring keeps the marker readable over the line.
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                    />
                  ))}
                </g>
              )}

              {/* Baseline */}
              <line
                x1={layout.padLeft}
                x2={layout.padLeft + plotW}
                y1={layout.padTop + plotH}
                y2={layout.padTop + plotH}
                stroke="hsl(var(--border))"
                strokeWidth={1}
              />
            </svg>

            {hover && (
              <div
                className="pointer-events-none absolute z-10 min-w-[7rem] rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-lg"
                style={{
                  left: Math.min(
                    Math.max(scaleX(hover.anchorT) + 10, 0),
                    Math.max(layout.width - 150, 0)
                  ),
                  top: layout.padTop,
                }}
                role="status"
              >
                <div className="text-2xs text-muted-foreground">
                  {new Date(hover.anchorT).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                {hover.readings.map((r) => (
                  <div key={r.id} className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: r.color }}
                      aria-hidden="true"
                    />
                    {series.length > 1 && (
                      <span className="text-muted-foreground">{r.label}</span>
                    )}
                    <span className="tabular ml-auto font-medium text-foreground">
                      {formatValue(r.point.v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
