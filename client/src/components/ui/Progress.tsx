import React from 'react';
import { cn } from '../../lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  indicatorClassName?: string;
  variant?: 'default' | 'dynamic' | 'pastel-sky' | 'pastel-mint' | 'pastel-lavender' | 'pastel-peach' | 'pastel-amber' | 'rose' | 'amber' | 'emerald';
  height?: 'sm' | 'md' | 'lg';
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, indicatorClassName, variant = 'default', height = 'md', ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, value || 0));

    let barColor = 'bg-sky-400 dark:bg-sky-400';
    if (variant === 'dynamic') {
      if (clamped >= 90) barColor = 'bg-gradient-to-r from-rose-400 to-pink-500 shadow-[0_0_12px_rgba(251,113,133,0.4)]';
      else if (clamped >= 75) barColor = 'bg-gradient-to-r from-amber-300 to-orange-400';
      else barColor = 'bg-gradient-to-r from-sky-400 to-indigo-400';
    } else if (variant === 'pastel-sky') {
      barColor = 'bg-sky-400 dark:bg-sky-400';
    } else if (variant === 'pastel-mint' || variant === 'emerald') {
      barColor = 'bg-emerald-400 dark:bg-emerald-400';
    } else if (variant === 'pastel-lavender') {
      barColor = 'bg-violet-400 dark:bg-violet-400';
    } else if (variant === 'pastel-peach' || variant === 'rose') {
      barColor = 'bg-rose-400 dark:bg-rose-400';
    } else if (variant === 'pastel-amber' || variant === 'amber') {
      barColor = 'bg-amber-400 dark:bg-amber-400';
    }

    const heightStyles = {
      sm: 'h-1.5',
      md: 'h-2',
      lg: 'h-3',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/90 border border-black/5 dark:border-white/5',
          heightStyles[height],
          className
        )}
        {...props}
      >
        <div
          className={cn('h-full transition-all duration-500 ease-out rounded-full', barColor, indicatorClassName)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = 'Progress';
