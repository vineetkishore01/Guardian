import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'xs';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm active:scale-[0.98]',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border shadow-sm active:scale-[0.98]',
      outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground shadow-sm active:scale-[0.98]',
      ghost: 'bg-transparent hover:bg-accent hover:text-accent-foreground text-muted-foreground hover:text-foreground',
      destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm active:scale-[0.98]',
      success: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm active:scale-[0.98]',
    };

    const sizeStyles = {
      xs: 'h-6 px-2 text-[11px] rounded',
      sm: 'h-8 px-2.5 text-xs rounded-md',
      md: 'h-9 px-3.5 text-xs sm:text-sm rounded-md',
      lg: 'h-10 px-5 text-sm rounded-md',
      icon: 'h-8 w-8 rounded-md p-0 flex items-center justify-center',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none',
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
