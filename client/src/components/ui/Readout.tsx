import React from 'react';
import { cn } from '../../lib/utils';

interface ReadoutProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: React.ReactNode;
  /** Rendered small and muted, so the number is what the eye lands on. */
  unit?: string;
}

/** Monospace telemetry value with a quiet unit. The one way numbers are shown. */
export function Readout({ value, unit, className, ...props }: ReadoutProps) {
  return (
    <span className={cn('font-mono tabular-nums', className)} {...props}>
      {value}
      {unit && <span className="ml-0.5 text-[0.8em] font-normal text-muted-foreground">{unit}</span>}
    </span>
  );
}

/** Splits a formatted "12.3 MB/s" / "4.1 GB" string into value and unit. */
export function splitUnit(formatted: string): { value: string; unit: string } {
  const i = formatted.lastIndexOf(' ');
  return i === -1 ? { value: formatted, unit: '' } : { value: formatted.slice(0, i), unit: formatted.slice(i + 1) };
}
