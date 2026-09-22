import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

interface SectionNavItem {
  id: string;
  label: string;
}

const SECTIONS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'system', label: 'System' },
  { id: 'storage', label: 'Storage' },
  { id: 'network', label: 'Network' },
  { id: 'apps', label: 'Apps' },
  { id: 'services', label: 'Services' },
];

interface SectionNavProps {
  problemsCount?: number;
  problemsSeverity?: 'warn' | 'crit';
  volumeCount?: number;
  appsRunning?: number;
  appsTotal?: number;
  servicesDownCount?: number;
}

/**
 * Sticky sub-nav under the header. Badges are only ever a live count pulled
 * from telemetry -- System and Network never get one, since there is no
 * number for either that isn't filler.
 */
export function SectionNav({
  problemsCount = 0,
  problemsSeverity,
  volumeCount,
  appsRunning,
  appsTotal,
  servicesDownCount = 0,
}: SectionNavProps) {
  const [activeId, setActiveId] = useState<string>('overview');

  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (targets.length === 0) return;

    // Narrow band just under the sticky header + nav, so the tab flips as
    // soon as a section's heading crosses it rather than waiting for the
    // whole section to leave the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-112px 0px -70% 0px', threshold: 0 }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const badgeFor = (id: string): { text: string; tone: 'warn' | 'crit' | 'neutral' } | null => {
    switch (id) {
      case 'overview':
        return problemsCount > 0 ? { text: String(problemsCount), tone: problemsSeverity ?? 'warn' } : null;
      case 'storage':
        return volumeCount ? { text: String(volumeCount), tone: 'neutral' } : null;
      case 'apps':
        return appsTotal ? { text: `${appsRunning ?? 0}/${appsTotal}`, tone: 'neutral' } : null;
      case 'services':
        return servicesDownCount > 0 ? { text: String(servicesDownCount), tone: 'crit' } : null;
      default:
        return null;
    }
  };

  return (
    <nav
      aria-label="Section navigation"
      className="sticky top-14 z-20 border-b border-border/60 bg-background/95 backdrop-blur-sm"
    >
      <div className="no-scrollbar mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {SECTIONS.map((section) => {
          const badge = badgeFor(section.id);
          const isActive = activeId === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-2xs font-medium transition-colors',
                isActive
                  ? 'border-brand text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {section.label}
              {badge && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 font-mono text-3xs font-semibold',
                    badge.tone === 'crit' && 'bg-crit-soft text-crit',
                    badge.tone === 'warn' && 'bg-warn-soft text-warn',
                    badge.tone === 'neutral' && 'bg-muted text-muted-foreground'
                  )}
                >
                  {badge.text}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
