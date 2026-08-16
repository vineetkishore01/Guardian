import React from 'react';
import {
  Shield,
  Network,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Sun,
  Moon,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { HostTelemetry, DashboardSettings, DockerSystemDf } from '../../types/dashboard';

interface HeaderProps {
  host?: HostTelemetry;
  settings?: DashboardSettings;
  dockerDf?: DockerSystemDf | null;
  connected: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAddApp: () => void;
  onOpenPruneModal: () => void;
  onChangeHostMode: (mode: DashboardSettings['defaultHostMode']) => void;
}

export function Header({
  host,
  settings,
  dockerDf,
  connected,
  isDark,
  onToggleTheme,
  onOpenSettings,
  onOpenAddApp,
  onOpenPruneModal,
  onChangeHostMode,
}: HeaderProps) {
  const currentMode = settings?.defaultHostMode || 'auto';

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-xl transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Brand & Server Specs */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex items-center justify-center h-10 w-10 rounded-xl bg-sky-500/10 dark:bg-sky-500/20 border border-sky-500/30 shadow-sm">
            <Shield className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
                Guardian
              </h1>
              <Badge variant="pastel-sky" className="hidden sm:inline-flex text-[10px] px-2 py-0">
                v1.0
              </Badge>
              {connected ? (
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-800/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Connecting
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-medium">
              <span className="font-mono text-foreground font-semibold">{host?.hostname || 'serverx'}</span>
              <span>•</span>
              <span>Debian 13</span>
              <span>•</span>
              <span className="hidden md:inline">i5-8265U (8T)</span>
              <span>•</span>
              <span className="text-sky-600 dark:text-sky-300 font-medium">Up {host?.uptimeFormatted || '2d 11h'}</span>
            </div>
          </div>
        </div>

        {/* Right: Network Host Selector, Theme Switcher & Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Target Host Switcher */}
          <div className="hidden lg:flex items-center gap-1 bg-secondary p-1 rounded-xl border border-border text-xs">
            <span className="px-2 text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
              <Network className="h-3.5 w-3.5 text-sky-500" />
              Target Host:
            </span>
            <button
              onClick={() => onChangeHostMode('auto')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                currentMode === 'auto'
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Detects automatically from current browser location"
            >
              Auto
            </button>
            <button
              onClick={() => onChangeHostMode('lan')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all font-mono ${
                currentMode === 'lan'
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="LAN IP: 192.168.0.26"
            >
              LAN (.26)
            </button>
            <button
              onClick={() => onChangeHostMode('tailscale')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all font-mono ${
                currentMode === 'tailscale'
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Tailscale IP: 100.94.238.9"
            >
              Tailscale (.9)
            </button>
          </div>

          {/* Docker Reclaimable Space Quick Badge */}
          {dockerDf && dockerDf.reclaimableTotalBytes > 1024 * 1024 * 1024 && (
            <button
              onClick={onOpenPruneModal}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 hover:bg-amber-500/20 transition-all shadow-sm"
              title="Docker images hold reclaimable space"
            >
              <Trash2 className="h-3.5 w-3.5 text-amber-500" />
              <span>{dockerDf.reclaimableFormatted} reclaimable</span>
            </button>
          )}

          {/* Light / Dark Mode Toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleTheme}
            className="h-8 w-8 text-foreground"
            title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
          </Button>

          {/* Add App Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenAddApp}
            className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300 border-border"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add Bookmark</span>
          </Button>

          {/* Settings Button */}
          <Button
            variant="outline"
            size="icon"
            onClick={onOpenSettings}
            className="h-8 w-8 text-foreground"
            title="Dashboard Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
