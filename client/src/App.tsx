import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw, Info } from 'lucide-react';
import { Header } from './components/layout/Header';
import { PruneAdvisorBanner } from './components/layout/PruneAdvisorBanner';
import { HostStatsBar } from './components/metrics/HostStatsBar';
import { StorageGauges } from './components/metrics/StorageGauges';
import { NetworkHealthCard } from './components/network/NetworkHealthCard';
import { AppGrid } from './components/apps/AppGrid';
import { ServicesTable } from './components/services/ServicesTable';
import { SettingsModal } from './components/layout/SettingsModal';
import { AddAppModal } from './components/apps/AddAppModal';
import { LogsPanel } from './components/logs/LogsPanel';
import { ContainerLogsModal } from './components/logs/ContainerLogsModal';
import { ProcessModal } from './components/processes/ProcessModal';
import { MetricDetailPage } from './pages/MetricDetailPage';
import { useLiveTelemetry } from './hooks/useLiveTelemetry';
import { useRoute } from './lib/router';
import { Button } from './components/ui/Button';
import { formatAgo, formatBytes } from './lib/utils';
import { ContainerItem, MetricKey } from './types/dashboard';

/** Quiet section heading. The data below it should be the loudest thing. */
function SectionHeading({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="section-label">{title}</h2>
      {aside && <div className="shrink-0 text-2xs text-muted-foreground">{aside}</div>}
    </div>
  );
}

export function App() {
  const {
    data,
    loading,
    connected,
    error,
    refetch,
    updateContainer,
    restartContainer,
    updateContainerImage,
    addCustomApp,
    deleteCustomApp,
    updateSettings,
    pruneDocker,
    refreshProbes,
    speedtestHistory,
    runSpeedtest,
    refreshWan,
  } = useLiveTelemetry();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addAppOpen, setAddAppOpen] = useState(false);
  const [processesOpen, setProcessesOpen] = useState<{ open: boolean; sort: 'cpu' | 'mem' }>({
    open: false,
    sort: 'cpu',
  });
  const [logsContainer, setLogsContainer] = useState<ContainerItem | null>(null);

  const [route, navigate] = useRoute();
  const openMetric = (metric: MetricKey) => navigate({ name: 'metric', metric });

  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('guardian_theme');
    if (saved) return saved === 'dark';
    // Match the pre-paint script in index.html so the two never disagree.
    return !window.matchMedia('(prefers-color-scheme: light)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('guardian_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Reflect the configured dashboard title in the tab.
  useEffect(() => {
    const title = data?.config?.settings?.title;
    document.title = title ? `${title} — Guardian` : 'Guardian — Server Dashboard';
  }, [data?.config?.settings?.title]);

  const disks = useMemo(() => {
    return (data?.host?.disks || []).filter(
      (d) =>
        !/^\/(boot|efi)(\/|$)/i.test(d.mountPoint) &&
        !/^(efi|boot)$/i.test(d.label || '')
    );
  }, [data?.host?.disks]);

  // Every summary below is derived from live telemetry. The previous build
  // printed fixed strings ("94% full", "16 Containers") that stayed put no
  // matter what the server actually reported.
  const storageSummary = useMemo(() => {
    if (!disks || disks.length === 0) return null;
    const tightest = disks.reduce((worst, d) => (d.usedPercent > worst.usedPercent ? d : worst));
    return {
      count: disks.length,
      tightest,
      totalFree: disks.reduce((sum, d) => sum + d.freeBytes, 0),
    };
  }, [disks]);

  // Name any collector that fell back to sample data, so the banner can be
  // explicit about what is and is not a real measurement.
  const syntheticSources = useMemo(() => {
    const sources = data?.sources;
    if (!sources) return [];
    return [
      sources.host === 'synthetic' ? 'host' : null,
      sources.docker === 'synthetic' ? 'Docker' : null,
    ].filter((s): s is string => s !== null);
  }, [data?.sources]);

  const containerSummary = useMemo(() => {
    const containers = data?.containers ?? [];
    return {
      total: containers.length,
      running: containers.filter((c) => c.state === 'running').length,
      bookmarks: data?.config?.customApps?.length ?? 0,
    };
  }, [data?.containers, data?.config?.customApps]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        host={data?.host}
        settings={data?.config?.settings}
        dockerDf={data?.dockerDf}
        connected={connected}
        isDark={isDark}
        onToggleTheme={() => setIsDark((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAddApp={() => setAddAppOpen(true)}
        onOpenProcesses={() => setProcessesOpen({ open: true, sort: 'cpu' })}
        onChangeHostMode={(mode) => updateSettings({ defaultHostMode: mode })}
      />

      {route.name === 'metric' ? (
        <MetricDetailPage
          metric={route.metric}
          liveHost={data?.host}
          liveHistory={data?.history}
          onBack={() => navigate({ name: 'dashboard' })}
        />
      ) : (
      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-7 px-4 py-6 sm:px-6 lg:px-8">
        {error && !connected && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-crit/25 bg-crit-soft/60 px-3.5 py-2.5 text-xs text-foreground"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-crit" aria-hidden="true" />
              <span className="truncate">
                Telemetry stream interrupted ({error}). Retrying automatically.
              </span>
            </span>
            <Button variant="outline" size="xs" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {syntheticSources.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft/60 px-3.5 py-2.5 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
            <p className="text-foreground">
              Showing sample {syntheticSources.join(' and ')} data — Guardian could not reach the
              real source.{' '}
              <span className="text-muted-foreground">
                {syntheticSources.includes('Docker')
                  ? 'Mount /var/run/docker.sock to read live containers. '
                  : ''}
                {syntheticSources.includes('host')
                  ? 'Host metrics need /proc and /sys from a Linux host.'
                  : ''}
              </span>
            </p>
          </div>
        )}

        <PruneAdvisorBanner dockerDf={data?.dockerDf} onPrune={pruneDocker} />

        <section aria-labelledby="system-heading">
          <SectionHeading
            title="System"
            aside={
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setProcessesOpen({ open: true, sort: 'cpu' })}
                  className="text-2xs font-medium text-brand hover:underline"
                >
                  View processes
                </button>
                {data?.host?.timestamp ? (
                  <span title={new Date(data.host.timestamp).toLocaleString()}>
                    updated {formatAgo(data.host.timestamp)}
                  </span>
                ) : null}
              </div>
            }
          />
          <HostStatsBar host={data?.host} history={data?.history} onOpenMetric={openMetric} />
        </section>

        <section aria-labelledby="storage-heading">
          <SectionHeading
            title="Storage"
            aside={
              storageSummary ? (
                <span>
                  {formatBytes(storageSummary.totalFree)} free across {storageSummary.count} volume
                  {storageSummary.count === 1 ? '' : 's'}
                  {storageSummary.tightest.usedPercent >= 90 && (
                    <span className="text-crit">
                      {' '}
                      · {storageSummary.tightest.mountPoint} at{' '}
                      {storageSummary.tightest.usedPercent.toFixed(0)}%
                    </span>
                  )}
                </span>
              ) : null
            }
          />
          <StorageGauges disks={disks} onOpenHistory={() => openMetric('disk')} />
        </section>

        <section aria-labelledby="network-heading">
          <SectionHeading title="Internet & WAN" />
          <NetworkHealthCard
            wan={data?.host?.wan}
            speedtestHistory={speedtestHistory}
            onRunSpeedtest={runSpeedtest}
            onRefreshWan={refreshWan}
          />
        </section>

        <section aria-labelledby="apps-heading">
          <SectionHeading
            title="Applications"
            aside={
              <span>
                {containerSummary.running} running
                {containerSummary.total > containerSummary.running &&
                  ` of ${containerSummary.total}`}
                {containerSummary.bookmarks > 0 && ` · ${containerSummary.bookmarks} bookmarks`}
              </span>
            }
          />
          <AppGrid
            containers={data?.containers}
            customApps={data?.config?.customApps}
            settings={data?.config?.settings}
            loading={loading && !data}
            onSaveContainer={updateContainer}
            onSaveBookmark={addCustomApp}
            onDeleteBookmark={deleteCustomApp}
            onOpenAddApp={() => setAddAppOpen(true)}
            onViewLogs={setLogsContainer}
            onRestartContainer={async (container) => {
              await restartContainer(container.name || container.id);
            }}
            onUpdateContainer={async (container) => {
              await updateContainerImage(container.name || container.id);
            }}
          />
        </section>

        <section aria-labelledby="health-heading">
          <ServicesTable
            probes={data?.probes}
            settings={data?.config?.settings}
            onRefreshProbes={refreshProbes}
          />
        </section>

        <section aria-labelledby="logs-heading">
          <LogsPanel />
        </section>
      </main>
      )}

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-1 px-4 py-5 text-2xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <span>Guardian — self-hosted server &amp; Docker dashboard</span>
          {data?.host && (
            <span className="font-mono">
              {data.host.hostname} · kernel {data.host.kernel} · {containerSummary.total} container
              {containerSummary.total === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </footer>

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

      {logsContainer && (
        <ContainerLogsModal
          open
          onOpenChange={(open) => !open && setLogsContainer(null)}
          containerId={logsContainer.id}
          containerName={logsContainer.displayName || logsContainer.name}
          onRestartContainer={async (id) => {
            await restartContainer(id);
          }}
        />
      )}

      <ProcessModal
        open={processesOpen.open}
        onOpenChange={(open) => setProcessesOpen((prev) => ({ ...prev, open }))}
        initialSort={processesOpen.sort}
      />
    </div>
  );
}

export default App;
