import React from 'react';
import { cn } from '../../lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
  'aria-label'?: string;
}

export function Tabs({ tabs, activeTab, onChange, className, ...props }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={props['aria-label'] ?? 'Categories'}
      className={cn(
        'no-scrollbar inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/60 p-1',
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.icon && <span className="flex h-3.5 w-3.5 items-center">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              // Previously `py-0.2`, which is not a real Tailwind step and so
              // emitted no padding at all.
              <span
                className={cn(
                  'rounded px-1 py-px font-mono text-2xs',
                  isActive ? 'text-muted-foreground' : 'text-muted-foreground/70'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
