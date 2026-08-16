import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'brand' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
}

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  brand: 'bg-brand text-brand-foreground hover:bg-brand/90 shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-accent border border-border',
  outline: 'border border-border bg-card text-foreground hover:bg-accent hover:border-border',
  ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
  destructive: 'bg-crit text-white hover:bg-crit/90 shadow-sm',
};

const SIZES = {
  xs: 'h-7 px-2 text-2xs rounded-md gap-1',
  sm: 'h-8 px-2.5 text-xs rounded-md gap-1.5',
  md: 'h-9 px-3.5 text-xs rounded-md gap-1.5',
  lg: 'h-10 px-5 text-sm rounded-lg gap-2',
  icon: 'h-9 w-9 rounded-md p-0',
  'icon-sm': 'h-8 w-8 rounded-md p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';
