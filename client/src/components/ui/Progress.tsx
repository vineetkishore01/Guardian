import React from 'react';
import { cn, severityBarClass, severityFor, type Severity } from '../../lib/utils';

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  /** Explicit severity. Omit to derive it from `warnAt` / `critAt`. */
  severity?: Severity;
  warnAt?: number;
  critAt?: number;
  height?: 'xs' | 'sm' | 'md';
  indicatorClassName?: string;
}

const HEIGHTS = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
};

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      value,
      severity,
      warnAt = 75,
      critAt = 90,
      height = 'sm',
      indicatorClassName,
      ...props
    },
    ref
  ) => {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    const resolved = severity ?? severityFor(clamped, warnAt, critAt);

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-muted',
          HEIGHTS[height],
          className
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-500 ease-out',
            severityBarClass(resolved),
            indicatorClassName
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = 'Progress';
