import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | 'default'
    | 'secondary'
    | 'outline'
    | 'destructive'
    | 'success'
    | 'warning'
    | 'pastel-sky'
    | 'pastel-mint'
    | 'pastel-lavender'
    | 'pastel-peach'
    | 'pastel-amber';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variantStyles = {
    default: 'bg-primary text-primary-foreground border-transparent',
    secondary: 'bg-secondary text-secondary-foreground border-border',
    outline: 'border-border text-muted-foreground bg-transparent',
    destructive: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    'pastel-sky': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    'pastel-mint': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    'pastel-lavender': 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    'pastel-peach': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    'pastel-amber': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] sm:text-[11px] font-medium tracking-wide transition-colors',
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
}
