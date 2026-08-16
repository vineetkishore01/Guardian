import React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground',
        'transition-colors placeholder:text-muted-foreground',
        'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

/** Native select styled to match Input, so the two never drift apart. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-8 cursor-pointer rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground',
        'transition-colors focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25',
        className
      )}
      {...props}
    />
  )
);
Select.displayName = 'Select';

export interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  /** Right-aligned helper text on the label row (e.g. supported tokens). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

/** Consistent label / control / hint stack for every form row. */
export function Field({ label, hint, htmlFor, aside, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-2xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
