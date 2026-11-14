import { useState } from 'react';
import {
  Router,
  Cable,
  Wifi,
  ArrowDown,
  ArrowUp,
  Radio,
  Settings2,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  Plus,
} from 'lucide-react';
import {
  RouterFleet,
  RouterTelemetry,
  RouterWanInterface,
  RouterWanRole,
} from '../../types/dashboard';
import { Progress } from '../ui/Progress';
import { cn, formatBytes, formatUptime } from '../../lib/utils';
import { RouterDetailModal } from './RouterDetailModal';
import { ManageRoutersModal } from './ManageRoutersModal';

interface NetworkFleetCardProps {
  fleet?: RouterFleet;
  primaryRouter?: RouterTelemetry;
  onRefreshFleet?: () => void;
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
          ? 'bg-card text-foreground shadow-xs ring-1 ring-border/80 dark:bg-card/90 dark:ring-white/10'
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

export function NetworkFleetCard({ fleet, primaryRouter, onRefreshFleet }: NetworkFleetCardProps) {
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

  const nodes = fleet?.nodes || (primaryRouter ? [primaryRouter] : []);
  const gatewayNode = nodes.find((n) => n.role === 'gateway') || nodes[0] || primaryRouter;
  const apNodes = nodes.filter((n) => n.id !== gatewayNode?.id);

  const gatewayData = gatewayNode?.data;
  const totalFleetClients = fleet?.summary?.totalClients ?? (gatewayData?.wifi?.total_clients || 0);

  const openNodeDetail = (id?: string) => {
    setSelectedNodeId(id);
    setDetailModalOpen(true);
  };

  if (!gatewayData && nodes.length === 0) {
    return (
      <div className="mat-panel flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <Router className="h-5 w-5 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Router Fleet Offline</div>
            <div className="truncate text-2xs text-muted-foreground">
              No router endpoints configured or reachable.
            </div>
          </div>
        </div>
        <button
          onClick={() => setManageModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-brand" />
          Add Router
        </button>
      </div>
    );
  }

  const mwan = gatewayData?.multi_wan;
  const wans = mwan?.interfaces
    ? [...mwan.interfaces].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    : [];
  const activeWan = wans.find((w) => w.name === mwan?.active) || wans[0];
  const dnsOk = gatewayData?.adguard ? gatewayData.adguard.dns_responding || gatewayData.adguard.port53_udp : false;

  return (
    <>
      <div className="mat-panel overflow-hidden p-4 transition-all">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-brand">
              <Router className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-foreground">
                  Network Fleet
                </span>
                <span className="rounded-full bg-brand/10 px-2 py-0.5 font-mono text-3xs font-medium text-brand">
                  {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {totalFleetClients} Wi-Fi {totalFleetClients === 1 ? 'client' : 'clients'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setManageModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-1 text-2xs font-medium text-foreground hover:bg-muted/60 transition-colors"
              title="Add or configure routers"
            >
              <Settings2 className="h-3 w-3 text-muted-foreground" />
              Manage Fleet
            </button>
          </div>
        </div>

        {/* Primary Gateway Glance Bar */}
        {gatewayData && (
          <div className="mt-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  {gatewayNode?.label || gatewayData.system.model}
                </span>
                <span className="font-mono text-3xs">
                  {gatewayData.system.hostname} · up {formatUptime(gatewayData.system.uptime_secs)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {gatewayData.adguard && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 font-mono text-3xs',
                      dnsOk ? 'text-ok' : 'text-crit'
                    )}
                  >
                    {dnsOk ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                    DNS Shield {dnsOk ? 'Active' : 'Offline'}
                  </span>
                )}
                <button
                  onClick={() => openNodeDetail(gatewayNode?.id)}
                  className="flex items-center gap-1 text-3xs font-medium text-brand hover:underline"
                >
                  View Telemetry
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Gateway Uplinks Strip */}
            {wans.length > 0 && (
              <div className="flex flex-wrap gap-2 rounded-xl bg-muted/40 p-1">
                {wans.map((wan) => (
                  <WanSegment key={wan.name} wan={wan} active={wan.name === activeWan?.name} />
                ))}
              </div>
            )}

            {/* Gateway CPU / RAM Mini Bars */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-3xs text-muted-foreground">
                  <span>Gateway CPU</span>
                  <span className="font-semibold text-foreground">
                    {gatewayData.system.cpu_usage_percent.toFixed(0)}%
                  </span>
                </div>
                <Progress value={gatewayData.system.cpu_usage_percent} height="xs" />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-3xs text-muted-foreground">
                  <span>Gateway RAM</span>
                  <span className="font-semibold text-foreground">
                    {gatewayData.system.memory.used_percent.toFixed(0)}%
                  </span>
                </div>
                <Progress value={gatewayData.system.memory.used_percent} height="xs" />
              </div>
            </div>
          </div>
        )}

        {/* Access Points & Nodes Chips (Rule F#72: Bounded Cardinality) */}
        {apNodes.length > 0 && (
          <div className="mt-4 border-t border-border/40 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                Access Points & Mesh Nodes ({apNodes.length})
              </span>
              <span className="text-3xs text-muted-foreground">Click a node to inspect</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {apNodes.map((node) => {
                const nodeData = node.data;
                const isLive = node.status === 'live';
                const clientCount = nodeData?.wifi?.total_clients ?? 0;
                return (
                  <button
                    key={node.id}
                    onClick={() => openNodeDetail(node.id)}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-left transition-all hover:border-brand/50 hover:bg-muted/40 dark:bg-card/40'
                    )}
                  >
                    <span className="relative flex h-2 w-2 shrink-0">
                      {isLive && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                      )}
                      <span
                        className={cn(
                          'relative inline-flex h-2 w-2 rounded-full',
                          isLive ? 'bg-ok' : node.status === 'stale' ? 'bg-warn' : 'bg-crit'
                        )}
                      />
                    </span>

                    <Radio className="h-3.5 w-3.5 text-muted-foreground group-hover:text-brand transition-colors" />

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {node.label || nodeData?.system?.model || node.id}
                        </span>
                        <span className="rounded bg-muted px-1 py-0.2 font-mono text-3xs font-medium uppercase text-muted-foreground">
                          AP
                        </span>
                      </div>
                      <div className="font-mono text-3xs text-muted-foreground">
                        {isLive ? `${clientCount} clients · 1G Bridge` : (node.error || 'offline')}
                      </div>
                    </div>

                    <ChevronRight className="ml-1 h-3.5 w-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <RouterDetailModal
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        fleet={fleet}
        router={primaryRouter}
        initialNodeId={selectedNodeId}
      />

      {/* Manage Routers Modal */}
      <ManageRoutersModal
        open={manageModalOpen}
        onOpenChange={setManageModalOpen}
        onRoutersChanged={onRefreshFleet}
      />
    </>
  );
}
