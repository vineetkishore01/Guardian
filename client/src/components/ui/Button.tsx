import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'xs';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-sky-600 dark:bg-sky-500 text-white hover:bg-sky-700 dark:hover:bg-sky-400 shadow-sm shadow-sky-500/20',
      secondary: 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-white/10',
      outline: 'border border-slate-300 dark:border-white/15 bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-800 dark:text-slate-200',
      ghost: 'bg-transparent hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700 dark:hover:bg-rose-500 shadow-sm shadow-rose-500/20',
      success: 'bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500 shadow-sm shadow-emerald-500/20',
    };

    const sizeStyles = {
      xs: 'h-6 px-2 text-[11px] rounded-md',
      sm: 'h-8 px-3 text-xs rounded-lg',
      md: 'h-9 px-4 text-sm rounded-lg',
      lg: 'h-11 px-6 text-base rounded-xl',
      icon: 'h-8 w-8 rounded-lg p-0 flex items-center justify-center',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] select-none',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
