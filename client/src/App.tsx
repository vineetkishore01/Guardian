import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { PruneAdvisorBanner } from './components/layout/PruneAdvisorBanner';
import { HostStatsBar } from './components/metrics/HostStatsBar';
import { StorageGauges } from './components/metrics/StorageGauges';
import { AppGrid } from './components/apps/AppGrid';
import { ServicesTable } from './components/services/ServicesTable';
import { SettingsModal } from './components/layout/SettingsModal';
import { AddAppModal } from './components/apps/AddAppModal';
import { useLiveTelemetry } from './hooks/useLiveTelemetry';
import { RefreshCw, Server, AlertCircle } from 'lucide-react';
import { Button } from './components/ui/Button';

export function App() {
  const {
    data,
    loading,
    connected,
    error,
    refetch,
    updateContainer,
    addCustomApp,
    deleteCustomApp,
    updateSettings,
    pruneDocker,
    refreshProbes,
  } = useLiveTelemetry();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addAppOpen, setAddAppOpen] = useState(false);

  // Theme Management (Light / Dark)
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('guardian_theme');
    if (saved) return saved === 'dark';
    return true; // Default dark
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('guardian_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('guardian_theme', 'light');
    }
  }, [isDark]);

  if (loading && !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
        <div className="relative flex items-center justify-center h-16 w-16 rounded-2xl bg-sky-500/10 border border-sky-500/30 mb-4 animate-pulse">
          <Server className="h-8 w-8 text-sky-500" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Connecting to Guardian...</h2>
        <p className="text-xs text-muted-foreground mt-1">Collecting telemetry from Debian 13 host & Docker daemon</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground transition-colors duration-200">
      {/* Top Navbar Header */}
      <Header
        host={data?.host}
        settings={data?.config?.settings}
        dockerDf={data?.dockerDf}
        connected={connected}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAddApp={() => setAddAppOpen(true)}
        onOpenPruneModal={() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onChangeHostMode={(mode) => updateSettings({ defaultHostMode: mode })}
      />

      {/* Main Content Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Error Warning Banner if disconnected */}
        {error && !connected && (
          <div className="rounded-xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-950/40 p-3.5 flex items-center justify-between text-xs text-rose-800 dark:text-rose-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
              <span>Telemetry connection interrupted: {error}. Attempting auto-reconnect...</span>
            </div>
            <Button variant="outline" size="xs" onClick={() => refetch()} className="border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-200">
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </div>
        )}

        {/* 1. Docker Storage Optimization Advisor Banner (16.4 GB reclaimable space) */}
        <PruneAdvisorBanner dockerDf={data?.dockerDf} onPrune={pruneDocker} />

        {/* 2. Top Stats Bar: CPU %, RAM/Swap, Thermals (x86_pkg_temp ~47°C), Network I/O */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
              Live System Telemetry
            </h2>
            <span className="text-[11px] text-muted-foreground font-mono">
              Updated {new Date(data?.host?.timestamp || Date.now()).toLocaleTimeString()}
            </span>
          </div>
          <HostStatsBar host={data?.host} history={data?.history} />
        </section>

        {/* 3. Storage Gauges: Critical /mnt/nas @ 94% + Root / @ 18% */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
              Storage Pools & Partitions
            </h2>
            <span className="text-[11px] text-rose-600 dark:text-rose-400 font-mono font-medium">
              /mnt/nas: 94% full (190 GB free)
            </span>
          </div>
          <StorageGauges disks={data?.host?.disks} />
        </section>

        {/* 4. CasaOS-Style App Launcher Grid (The Centerpiece) */}
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-foreground tracking-tight">
                Applications & Services
              </h2>
              <p className="text-xs text-muted-foreground">
                Click any tile to launch in a new tab • Click gear to customize icon & custom URLs
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddAppOpen(true)}
              className="text-xs text-sky-700 dark:text-sky-300 border-border"
            >
              + Add Bookmark
            </Button>
          </div>

          <AppGrid
            containers={data?.containers}
            customApps={data?.config?.customApps}
            settings={data?.config?.settings}
            onSaveContainer={updateContainer}
            onSaveBookmark={addCustomApp}
            onDeleteBookmark={deleteCustomApp}
            onOpenAddApp={() => setAddAppOpen(true)}
          />
        </section>

        {/* 5. Health & Latency Prober Table */}
        <section className="space-y-2 pt-4">
          <ServicesTable
            probes={data?.probes}
            settings={data?.config?.settings}
            onRefreshProbes={refreshProbes}
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 py-6 text-center text-xs text-muted-foreground">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>Guardian — Ultra-lightweight Server & Docker Dashboard</p>
          <p className="font-mono text-[11px] text-foreground font-medium">
            Debian 13 • 16 Containers • Port :3001
          </p>
        </div>
      </footer>

      {/* Global Modals */}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={data?.config?.settings}
        onSaveSettings={updateSettings}
      />

      <AddAppModal
        open={addAppOpen}
        onOpenChange={setAddAppOpen}
        onAddBookmark={addCustomApp}
      />
    </div>
  );
}

export default App;
