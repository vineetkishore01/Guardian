import React from 'react';
import { Shield, Settings, Plus, Trash2, Sun, Moon, Activity } from 'lucide-react';
import { Button } from '../ui/Button';
import { PowerMenu } from './PowerMenu';
import { HostTelemetry, DashboardSettings, DockerSystemDf } from '../../types/dashboard';
import { cn, formatBytes } from '../../lib/utils';

interface HeaderProps {
  host?: HostTelemetry;
  settings?: DashboardSettings;
  dockerDf?: DockerSystemDf | null;
  connected: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAddApp: () => void;
  onOpenProcesses?: () => void;
  onChangeHostMode: (mode: DashboardSettings['defaultHostMode']) => void;
}

const RECLAIM_THRESHOLD = 512 * 1024 * 1024; // 512 MB of dangling layers

export function Header({
  host,
  settings,
  dockerDf,
  connected,
  isDark,
  onToggleTheme,
  onOpenSettings,
  onOpenAddApp,
  onOpenProcesses,
  onChangeHostMode,
}: HeaderProps) {
  const currentMode = settings?.defaultHostMode || 'auto';

  // Labels come from configured values rather than being baked into the markup,
  // so the switcher tells the truth on any machine.
  const hostModes: Array<{ id: DashboardSettings['defaultHostMode']; label: string; title: string }> = [
    { id: 'auto', label: 'Auto', title: 'Use the address this dashboard was opened from' },
    ...(settings?.lanIp
      ? [{ id: 'lan' as const, label: 'LAN', title: `Use LAN address ${settings.lanIp}` }]
      : []),
    ...(settings?.tailscaleIp
      ? [
          {
            id: 'tailscale' as const,
            label: 'Tailscale',
            title: `Use Tailscale address ${settings.tailscaleIp}`,
          },
        ]
      : []),
    ...(settings?.customHostUrl
      ? [
          {
            id: 'custom' as const,
            label: 'Custom',
            title: `Use custom host ${settings.customHostUrl}`,
          },
        ]
      : []),
  ];

  // Mirrors the banner: only advertise space the prune button can actually free.
  const reclaimable = dockerDf?.danglingBytes ?? 0;
  const showReclaim = reclaimable > RECLAIM_THRESHOLD;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <Shield className="h-4 w-4" aria-hidden="true" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">Guardian</h1>
              {/* One connection indicator, not two competing ones. */}
              <span
                className="flex items-center gap-1.5 text-2xs text-muted-foreground"
                title={connected ? 'Live telemetry stream connected' : 'Reconnecting to telemetry stream'}
              >
                <span className="relative flex h-1.5 w-1.5">
                  {connected && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                  )}
                  <span
                    className={cn(
                      'relative inline-flex h-1.5 w-1.5 rounded-full',
                      connected ? 'bg-ok' : 'bg-warn'
                    )}
                  />
                </span>
                <span className="hidden sm:inline">{connected ? 'Live' : 'Reconnecting'}</span>
              </span>
            </div>

            <p className="truncate text-2xs text-muted-foreground">
              {host ? (
                <>
                  <span className="font-mono text-foreground">{host.hostname}</span>
                  {host.os && <span className="hidden sm:inline"> · {host.os}</span>}
                  {host.uptimeFormatted && <span> · up {host.uptimeFormatted}</span>}
                </>
              ) : (
                'Connecting…'
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hostModes.length > 1 && (
            <div
              role="group"
              aria-label="App launch target"
              className="hidden items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5 xl:flex"
            >
              {hostModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onChangeHostMode(mode.id)}
                  title={mode.title}
                  aria-pressed={currentMode === mode.id}
                  className={cn(
                    'rounded-md px-2 py-1 text-2xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    currentMode === mode.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}

          {showReclaim && (
            <a
              href="#docker-cleanup"
              className="hidden items-center gap-1.5 rounded-md border border-warn/25 bg-warn-soft px-2 py-1 text-2xs font-medium text-warn transition-colors hover:border-warn/40 md:flex"
              title="Reclaimable Docker storage — jump to cleanup"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              {formatBytes(reclaimable)}
            </a>
          )}

          <Button variant="secondary" size="sm" onClick={onOpenAddApp}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Add</span>
          </Button>

          {onOpenProcesses && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenProcesses}
              title="Host processes (CPU & RAM)"
              aria-label="Host processes"
            >
              <Activity className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleTheme}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>

          {/* Renders nothing unless the server opted into power controls. */}
          <PowerMenu />
        </div>
      </div>
    </header>
  );
}
