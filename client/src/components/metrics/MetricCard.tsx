import React from 'react';
import { LiveSparkline } from '../charts/LiveSparkline';
import { Progress } from '../ui/Progress';
import { cn, severityTextClass, type Severity } from '../../lib/utils';

export interface MetricCardProps {
  label: string;
  /** The headline number, already formatted. */
  value: string;
  /** Small unit or qualifier trailing the value. */
  unit?: string;
  /** Right-aligned context on the label row. */
  meta?: React.ReactNode;
  severity?: Severity;
  /** 0–100. Renders a bar when provided. */
  percent?: number;
  trend?: number[];
  trendMin?: number;
  trendMax?: number;
  /** Detail row at the foot of the card. */
  footer?: React.ReactNode;
  className?: string;
}

/*
 * One shape for every headline metric. Uniformity is the point: when all four
 * cards share a grid, a reader compares values instead of decoding four
 * different layouts. Colour appears only when `severity` says something is
 * wrong, so a healthy dashboard reads as calm monochrome.
 */
export function MetricCard({
  label,
  value,
  unit,
  meta,
  severity = 'ok',
  percent,
  trend,
  trendMin,
  trendMax,
  footer,
  className,
}: MetricCardProps) {
  const trendColor =
    severity === 'crit'
      ? 'hsl(var(--crit))'
      : severity === 'warn'
      ? 'hsl(var(--warn))'
      : 'hsl(var(--brand))';

  return (
    <div className={cn('surface flex flex-col p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {meta && <div className="shrink-0 text-2xs text-muted-foreground">{meta}</div>}
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'tabular text-[26px] font-semibold leading-none tracking-tight',
              severityTextClass(severity)
            )}
          >
            {value}
          </span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>

        {trend && trend.length > 1 && (
          <LiveSparkline
            data={trend}
            width={76}
            height={26}
            color={trendColor}
            min={trendMin}
            max={trendMax}
            className="shrink-0 opacity-90"
          />
        )}
      </div>

      {percent !== undefined && (
        <Progress value={percent} severity={severity} height="xs" className="mt-3" />
      )}

      {footer && (
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-2xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Loading placeholder matching MetricCard's footprint exactly. */
export function MetricCardSkeleton() {
  return (
    <div className="surface flex flex-col p-4">
      <div className="skeleton h-3 w-20" />
      <div className="mt-3 skeleton h-7 w-24" />
      <div className="mt-3 skeleton h-1 w-full" />
      <div className="mt-4 skeleton h-2.5 w-32" />
    </div>
  );
}
