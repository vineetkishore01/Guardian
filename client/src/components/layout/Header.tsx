import React, { useEffect, useState } from 'react';
import { Shield, Settings, Plus, Sun, Moon, Activity } from 'lucide-react';
import { Button } from '../ui/Button';
import { PowerMenu } from './PowerMenu';
import { HostTelemetry, DashboardSettings } from '../../types/dashboard';
import { cn, formatAgo } from '../../lib/utils';

interface HeaderProps {
  host?: HostTelemetry;
  settings?: DashboardSettings;
  connected: boolean;
  /** Browser time of the last telemetry frame applied; null before the first. */
  lastSyncAt?: number | null;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAddApp: () => void;
  onOpenProcesses?: () => void;
  onChangeHostMode: (mode: DashboardSettings['defaultHostMode']) => void;
}

/** Telemetry is sampled every few seconds; this long without a frame is a stall, not jitter. */
const STALE_AFTER_MS = 30_000;

/**
 * Freshness heartbeat: is the number I am looking at current?
 *
 * "Live" is only claimed while frames are actually arriving. A stream that is
 * technically open but silent turns amber and keeps counting, rather than
 * continuing to say "Live" over data that stopped moving.
 */
function SyncBadge({ connected, lastSyncAt }: { connected: boolean; lastSyncAt?: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const age = lastSyncAt ? Date.now() - lastSyncAt : null;
  const stale = age !== null && age > STALE_AFTER_MS;
  const healthy = connected && !stale;

  const state = lastSyncAt === null || lastSyncAt === undefined
    ? 'Connecting'
    : !connected
    ? 'Reconnecting'
    : stale
    ? 'Stale'
    : 'Live';

  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-1 text-2xs text-muted-foreground"
      title={
        lastSyncAt
          ? `Last telemetry frame received ${new Date(lastSyncAt).toLocaleTimeString()}`
          : 'Waiting for the first telemetry frame'
      }
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          healthy ? 'bg-ok' : lastSyncAt ? 'bg-warn' : 'bg-muted-foreground'
        )}
        aria-hidden="true"
      />
      <span className={cn('font-medium', healthy ? 'text-foreground' : 'text-warn')}>{state}</span>
      {lastSyncAt ? (
        <span className="hidden font-mono tabular-nums sm:inline">
          · synced {formatAgo(lastSyncAt)}
        </span>
      ) : null}
    </span>
  );
}

export function Header({
  host,
  settings,
  connected,
  lastSyncAt,
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
            </div>

            <p className="truncate text-2xs text-muted-foreground">
              {host ? (
                <>
                  <span className="font-mono text-foreground">{host.hostname}</span>
                  {host.os && <span className="hidden sm:inline"> · {host.os}</span>}
                  {host.uptimeFormatted && (
                    <span
                      title={host.uptimeInfo?.bootFormatted ? `System booted: ${host.uptimeInfo.bootFormatted}` : undefined}
                      className="cursor-default"
                    >
                      {' '}· up {host.uptimeFormatted}
                    </span>
                  )}
                </>
              ) : (
                'Connecting…'
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SyncBadge connected={connected} lastSyncAt={lastSyncAt} />

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
