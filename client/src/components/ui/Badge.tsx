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
    | 'cyan'
    | 'purple'
    | 'pastel-sky'
    | 'pastel-mint'
    | 'pastel-lavender'
    | 'pastel-peach'
    | 'pastel-amber';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variantStyles = {
    default: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    secondary: 'bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10',
    outline: 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300 bg-transparent',
    destructive: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    cyan: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
    'pastel-sky': 'bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-500/30',
    'pastel-mint': 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-500/30',
    'pastel-lavender': 'bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border-violet-300 dark:border-violet-500/30',
    'pastel-peach': 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-500/30',
    'pastel-amber': 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/30',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors',
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
}
