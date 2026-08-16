import React from 'react';
import { cn } from '../../lib/utils';

/*
 * Deliberately small variant set. The previous five "pastel-*" variants let any
 * card pick any hue, which is how the dashboard ended up with sky / violet /
 * mint / peach / amber all shouting at equal volume. Colour here now means
 * state; `neutral` is the default and should cover most labels.
 */
export type BadgeVariant = 'neutral' | 'brand' | 'ok' | 'warn' | 'crit' | 'outline';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-secondary text-secondary-foreground border-transparent',
  brand: 'bg-brand-soft text-brand border-brand/20',
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-warn-soft text-warn border-warn/20',
  crit: 'bg-crit-soft text-crit border-crit/20',
  outline: 'bg-transparent text-muted-foreground border-border',
};

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-none',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}
