import { useState } from 'react';
import {
  Router,
  Cable,
  Wifi,
  ArrowDown,
  ArrowUp,
  Cpu,
  MemoryStick,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  Activity,
  Layers,
} from 'lucide-react';
import {
  RouterTelemetry,
  RouterWanInterface,
  RouterWanRole,
} from '../../types/dashboard';
import { Progress } from '../ui/Progress';
import { cn, formatBytes, formatAgo, formatUptime } from '../../lib/utils';
import { RouterDetailModal } from './RouterDetailModal';

interface RouterTelemetryCardProps {
  router: RouterTelemetry;
}

const ROLE_ORDER: Record<RouterWanRole, number> = { primary: 0, backup: 1 };

function WanSegment({ wan, active }: { wan: RouterWanInterface; active: boolean }) {
  const Icon = wan.role === 'primary' ? Cable : Wifi;
  const rxMbps = wan.rx_rate_mbps ?? 0;
  const txMbps = wan.tx_rate_mbps ?? 0;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 transition-all',
        active
          ? 'bg-card text-foreground shadow-sm ring-1 ring-border/80 dark:bg-card/90 dark:ring-white/10'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          {wan.online && active && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
          )}
          <span
            className={cn('relative inline-flex h-2 w-2 rounded-full', wan.online ? 'bg-ok' : 'bg-crit')}
          />
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground">{wan.label}</span>
            {active && (
              <span className="rounded bg-brand/15 px-1 py-0.2 font-mono text-3xs font-medium text-brand">
                ACTIVE
              </span>
            )}
          </div>
          <div className="truncate font-mono text-3xs text-muted-foreground">
            {wan.online ? (wan.latency_ms !== null ? `${wan.latency_ms.toFixed(1)} ms` : 'online') : wan.status}
          </div>
        </div>
      </div>

      {active && (rxMbps > 0 || txMbps > 0) && (
        <div className="flex items-center gap-2 text-right font-mono text-3xs tabular">
          <span className="flex items-center gap-0.5 text-ok">
            <ArrowDown className="h-2.5 w-2.5" />
            {rxMbps.toFixed(1)}M
          </span>
          <span className="flex items-center gap-0.5 text-brand">
            <ArrowUp className="h-2.5 w-2.5" />
            {txMbps.toFixed(1)}M
          </span>
        </div>
      )}
    </div>
  );
}

export function RouterTelemetryCard({ router }: RouterTelemetryCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const data = router.data;

  if (!data) {
    return (
      <div className="mat-panel flex items-center gap-3 p-4">
        <Router className="h-5 w-5 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Router offline</div>
          <div className="truncate text-2xs text-muted-foreground">
            No telemetry from {router.endpoint}
            {router.error ? ` — ${router.error}` : ''}
          </div>
        </div>
      </div>
    );
  }

  const { system, multi_wan: mwan, wifi, adguard } = data;
  const wans = [...mwan.interfaces].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const activeWan = wans.find((w) => w.name === mwan.active) || wans[0];
  const dnsOk = adguard.dns_responding || adguard.port53_udp;
  const clients = wifi.clients || [];
  const clientCount = clients.length || wifi.total_clients;
  const count5G = clients.filter((c) => c.connection_type.includes('5 GHz')).length;
  const count2G = clients.filter((c) => c.connection_type.includes('2.4 GHz')).length;
  const countWired = clients.filter((c) => c.connection_type.includes('Wired')).length;

  const totalRxRate = wans.reduce((sum, w) => sum + (w.rx_rate_mbps ?? 0), 0);
  const totalTxRate = wans.reduce((sum, w) => sum + (w.tx_rate_mbps ?? 0), 0);

  return (
    <>
      <div className="mat-panel overflow-hidden p-4 transition-all">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-brand">
              <Router className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-foreground">
                  {system.model}
                </span>
                <span className="font-mono text-3xs text-muted-foreground">
                  {system.hostname} · up {formatUptime(system.uptime_secs)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-2xs">
            {router.status === 'stale' && (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">
                stale · {formatAgo(router.fetchedAt ?? undefined)}
              </span>
            )}
            {mwan.failover ? (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">
                Failover active
              </span>
            ) : (
              <span className="rounded-full bg-ok/15 px-2 py-0.5 font-medium text-ok">
                Zero-Wear Failover Armed
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
                dnsOk ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit'
              )}
              title={`AdGuard DNS :53 — tcp ${adguard.port53_tcp ? 'up' : 'down'}, udp ${adguard.port53_udp ? 'up' : 'down'}`}
            >
              {dnsOk ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              AdGuard Shield
            </span>
          </div>
        </div>

        {/* Multi-WAN Uplinks Track */}
        <div className="mt-3.5 flex flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1.5 sm:flex-row dark:border-white/5 dark:bg-black/30">
          {wans.map((w) => (
            <WanSegment key={w.name} wan={w} active={mwan.active === w.name} />
          ))}
        </div>

        {/* Decluttered Glance Wells (3 Columns) */}
        <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
          {/* Well 1: Live WAN Throughput */}
          <div
            onClick={() => setModalOpen(true)}
            className="mat-well group cursor-pointer p-3 transition-colors hover:border-brand/50 hover:bg-muted/70"
          >
            <div className="flex items-center justify-between text-3xs uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3 w-3 text-brand" />
                Live WAN Throughput
              </span>
              <span className="font-mono text-brand group-hover:underline">Details →</span>
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="font-mono text-base font-bold tabular tracking-tight text-foreground">
                <span className="text-ok">↓</span> {totalRxRate.toFixed(2)}{' '}
                <span className="text-3xs font-normal text-muted-foreground">Mbps</span>
              </div>
              <div className="font-mono text-xs font-semibold tabular text-muted-foreground">
                <span className="text-brand">↑</span> {totalTxRate.toFixed(2)}{' '}
                <span className="text-3xs font-normal">Mbps</span>
              </div>
            </div>
            <div className="mt-1 truncate font-mono text-3xs text-muted-foreground">
              Routed via {activeWan.label} · {activeWan.device}
            </div>
          </div>

          {/* Well 2: Connected Device Inventory */}
          <div
            onClick={() => setModalOpen(true)}
            className="mat-well group cursor-pointer p-3 transition-colors hover:border-brand/50 hover:bg-muted/70"
          >
            <div className="flex items-center justify-between text-3xs uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Wifi className="h-3 w-3 text-ok" />
                Connected Devices
              </span>
              <span className="font-mono text-ok group-hover:underline">View All →</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <div className="font-mono text-base font-bold tabular tracking-tight text-foreground">
                {clientCount}
              </div>
              <div className="text-xs text-muted-foreground">clients active</div>
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-3xs text-muted-foreground">
              <span>{count5G} on 5GHz</span>
              <span>·</span>
              <span>{count2G} on 2.4GHz</span>
              {countWired > 0 && (
                <>
                  <span>·</span>
                  <span>{countWired} wired</span>
                </>
              )}
            </div>
          </div>

          {/* Well 3: Router Hardware Health */}
          <div
            onClick={() => setModalOpen(true)}
            className="mat-well group cursor-pointer p-3 transition-colors hover:border-brand/50 hover:bg-muted/70"
          >
            <div className="flex items-center justify-between text-3xs uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3 text-brand" />
                Hardware Health
              </span>
              <span className="font-mono text-3xs text-muted-foreground group-hover:text-foreground">
                Inspect →
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-2xs">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Cpu className="h-3 w-3" /> CPU
                </span>
                <span className="font-mono text-3xs tabular text-foreground">
                  {system.cpu_usage_percent.toFixed(0)}%
                </span>
              </div>
              <Progress value={system.cpu_usage_percent} height="xs" />

              <div className="flex items-center justify-between text-2xs">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <MemoryStick className="h-3 w-3" /> RAM
                </span>
                <span className="font-mono text-3xs tabular text-foreground">
                  {system.memory.used_percent.toFixed(0)}%
                </span>
              </div>
              <Progress value={system.memory.used_percent} height="xs" />
            </div>
          </div>
        </div>

        {/* Bottom Quick-Action Link */}
        <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5 text-2xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
            <span>Multi-WAN policy: ACT Fibernet prioritized with zero flash wear</span>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1 font-medium text-brand transition-colors hover:text-brand/80"
          >
            <span>Network Intelligence & Device Inventory</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Pop-up modal dialog with blurred background */}
      <RouterDetailModal open={modalOpen} onOpenChange={setModalOpen} data={data} />
    </>
  );
}
