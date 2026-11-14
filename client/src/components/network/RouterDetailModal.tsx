import { useState, useMemo, useEffect } from 'react';
import {
  Router,
  Cable,
  Wifi,
  ArrowDown,
  ArrowUp,
  Cpu,
  MemoryStick,
  HardDrive,
  ShieldCheck,
  ShieldAlert,
  Search,
  Check,
  Copy,
  Radio,
  Signal,
  Laptop,
  Smartphone,
  Server,
  Network,
} from 'lucide-react';
import {
  RouterTelemetry,
  RouterFleet,
  RouterWanRole,
  RouterConnectedClient,
} from '../../types/dashboard';
import { Dialog } from '../ui/Dialog';
import { Tabs, TabItem } from '../ui/Tabs';
import { Progress } from '../ui/Progress';
import { cn, formatBytes, formatUptime } from '../../lib/utils';

interface RouterDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  router?: RouterTelemetry;
  fleet?: RouterFleet;
  initialNodeId?: string;
}

const ROLE_ORDER: Record<RouterWanRole, number> = { primary: 0, backup: 1 };

function getDeviceIcon(client: RouterConnectedClient) {
  const h = (client.hostname || '').toLowerCase();
  if (h.includes('mac') || h.includes('book') || h.includes('laptop') || h.includes('pc')) {
    return Laptop;
  }
  if (h.includes('phone') || h.includes('iphone') || h.includes('android')) {
    return Smartphone;
  }
  if (h.includes('server') || h.includes('nas') || h.includes('pi')) {
    return Server;
  }
  return client.connection_type.includes('Wired') ? Network : Wifi;
}

function getSignalQuality(dbm: number | null): { label: string; color: string; percent: number } {
  if (dbm === null) return { label: 'Wired', color: 'text-muted-foreground', percent: 100 };
  if (dbm >= -55) return { label: 'Excellent', color: 'text-ok', percent: 95 };
  if (dbm >= -67) return { label: 'Good', color: 'text-ok/80', percent: 75 };
  if (dbm >= -78) return { label: 'Fair', color: 'text-warn', percent: 50 };
  return { label: 'Weak', color: 'text-crit', percent: 25 };
}

export function RouterDetailModal({
  open,
  onOpenChange,
  router,
  fleet,
  initialNodeId,
}: RouterDetailModalProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    initialNodeId || router?.id || fleet?.nodes[0]?.id || ''
  );

  useEffect(() => {
    if (initialNodeId) {
      setSelectedNodeId(initialNodeId);
    } else if (router?.id) {
      setSelectedNodeId(router.id);
    } else if (fleet?.nodes[0]?.id) {
      setSelectedNodeId(fleet.nodes[0].id);
    }
  }, [initialNodeId, router, fleet]);

  const activeNode = useMemo(() => {
    if (fleet?.nodes && fleet.nodes.length > 0) {
      return fleet.nodes.find((n) => n.id === selectedNodeId) || fleet.nodes[0];
    }
    return router;
  }, [fleet, selectedNodeId, router]);

  const data = activeNode?.data;
  const isGateway = activeNode?.role === 'gateway' || Boolean(data?.multi_wan);

  const [activeTab, setActiveTab] = useState<'uplinks' | 'clients' | 'system'>('clients');
  const [searchQuery, setSearchQuery] = useState('');
  const [bandFilter, setBandFilter] = useState<'all' | '5ghz' | '2.4ghz' | 'wired'>('all');
  const [copiedMac, setCopiedMac] = useState<string | null>(null);

  // Set default tab on router change
  useEffect(() => {
    if (isGateway) {
      setActiveTab('uplinks');
    } else {
      setActiveTab('clients');
    }
  }, [selectedNodeId, isGateway]);

  if (!data) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Router Offline"
        description="No live telemetry is currently available from this router."
      >
        <div className="py-8 text-center text-sm text-muted-foreground">
          Router is unreachable. Please verify its IP and credentials.
        </div>
      </Dialog>
    );
  }

  const { system, multi_wan: mwan, wifi, adguard, ap } = data;
  const wans = mwan?.interfaces
    ? [...mwan.interfaces].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    : [];
  const bandwidth = data.isp_bandwidth
    ? [...data.isp_bandwidth].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    : [];
  const dnsOk = adguard ? adguard.dns_responding || adguard.port53_udp : false;
  const clients = wifi?.clients || [];

  const filteredClients = clients.filter((c) => {
    if (bandFilter === '5ghz' && !c.connection_type.includes('5 GHz') && c.connection_type !== 'wifi') return false;
    if (bandFilter === '2.4ghz' && !c.connection_type.includes('2.4 GHz')) return false;
    if (bandFilter === 'wired' && !c.connection_type.includes('Wired')) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.hostname && c.hostname.toLowerCase().includes(q)) ||
      (c.ip && c.ip.toLowerCase().includes(q)) ||
      (c.mac && c.mac.toLowerCase().includes(q)) ||
      (c.connection_type && c.connection_type.toLowerCase().includes(q))
    );
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMac(id);
    setTimeout(() => setCopiedMac(null), 2000);
  };

  const tabs: TabItem[] = [];
  if (isGateway && mwan) {
    tabs.push({ id: 'uplinks', label: 'Uplinks & Traffic', icon: <Cable className="h-3.5 w-3.5" /> });
  }
  tabs.push({
    id: 'clients',
    label: isGateway ? 'Connected Devices' : 'Associated Clients & Radios',
    count: clients.length || wifi?.total_clients || 0,
    icon: <Wifi className="h-3.5 w-3.5" />,
  });
  tabs.push({ id: 'system', label: 'Hardware & System', icon: <Cpu className="h-3.5 w-3.5" /> });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${activeNode?.label || system.model} · Network Intelligence`}
      description={`${system.hostname} · OpenWrt Linux ${system.kernel} · Uptime ${formatUptime(system.uptime_secs)}`}
      maxWidth="3xl"
    >
      <div className="space-y-4">
        {/* Router Fleet Selector Bar */}
        {fleet && fleet.nodes.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-border/50 pb-2.5">
            {fleet.nodes.map((n) => {
              const isCurrent = n.id === selectedNodeId;
              const isNodeGateway = n.role === 'gateway' || Boolean(n.data?.multi_wan);
              return (
                <button
                  key={n.id}
                  onClick={() => setSelectedNodeId(n.id || '')}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-all shrink-0',
                    isCurrent
                      ? 'bg-brand text-white shadow-sm'
                      : 'bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      n.status === 'live' ? 'bg-ok' : n.status === 'stale' ? 'bg-warn' : 'bg-crit'
                    )}
                  />
                  <span>{n.label || n.data?.system?.model || n.id}</span>
                  <span
                    className={cn(
                      'rounded px-1 py-0.2 font-mono text-3xs uppercase',
                      isCurrent ? 'bg-black/20 text-white' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isNodeGateway ? 'Gateway' : 'AP'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="border-b border-border/60 pb-3">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />
        </div>

        {/* TAB 1: Uplinks & Traffic (Gateways Only) */}
        {activeTab === 'uplinks' && mwan && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {wans.map((wan) => {
                const isActive = mwan.active === wan.name;
                const Icon = wan.role === 'primary' ? Cable : Wifi;
                return (
                  <div
                    key={wan.name}
                    className={cn(
                      'mat-well relative overflow-hidden p-3.5 transition-all',
                      isActive ? 'border-brand/40 bg-brand/5 dark:bg-brand/10' : 'opacity-85'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          {wan.online && isActive && (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                          )}
                          <span
                            className={cn(
                              'relative inline-flex h-2.5 w-2.5 rounded-full',
                              wan.online ? 'bg-ok' : 'bg-crit'
                            )}
                          />
                        </span>
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground">{wan.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="rounded-full bg-brand/20 px-2 py-0.5 font-mono text-3xs font-medium text-brand">
                            ACTIVE ROUTE
                          </span>
                        )}
                        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-3xs uppercase text-muted-foreground">
                          {wan.role}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-card/60 p-2 font-mono text-xs dark:bg-black/30">
                      <div>
                        <div className="flex items-center gap-1 text-3xs uppercase text-muted-foreground">
                          <ArrowDown className="h-3 w-3 text-ok" />
                          Download
                        </div>
                        <div className="mt-0.5 text-sm font-semibold tabular text-foreground">
                          {(wan.rx_rate_mbps ?? 0).toFixed(2)}{' '}
                          <span className="text-3xs text-muted-foreground">Mbps</span>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-3xs uppercase text-muted-foreground">
                          <ArrowUp className="h-3 w-3 text-brand" />
                          Upload
                        </div>
                        <div className="mt-0.5 text-sm font-semibold tabular text-foreground">
                          {(wan.tx_rate_mbps ?? 0).toFixed(2)}{' '}
                          <span className="text-3xs text-muted-foreground">Mbps</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between font-mono text-3xs text-muted-foreground">
                      <span>Device: {wan.device}</span>
                      <span>
                        Ping:{' '}
                        <strong className="font-semibold text-foreground">
                          {wan.latency_ms !== null ? `${wan.latency_ms.toFixed(1)} ms` : 'N/A'}
                        </strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: Connected Devices & Radios */}
        {activeTab === 'clients' && (
          <div className="space-y-4">
            {/* Wi-Fi Radios Banner */}
            {wifi?.radios && wifi.radios.length > 0 && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {wifi.radios.map((r, i) => (
                  <div key={i} className="mat-well flex items-center justify-between p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
                        <Radio className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">{r.ssid}</div>
                        <div className="font-mono text-3xs text-muted-foreground">
                          {r.device} · Ch {r.channel || 'Auto'} · {r.frequency_ghz ? `${r.frequency_ghz} GHz` : r.mode}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-full bg-muted/60 px-2 py-0.5 font-mono text-2xs font-medium text-foreground">
                      {r.clients} stations
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Filter / Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search device by name, IP, MAC..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1 text-2xs">
                {(['all', '5ghz', '2.4ghz', 'wired'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setBandFilter(filter)}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium capitalize transition-colors',
                      bandFilter === filter
                        ? 'bg-brand/15 text-brand'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {filter === 'all' ? 'All' : filter}
                  </button>
                ))}
              </div>
            </div>

            {/* Client Device Table */}
            <div className="mat-well overflow-hidden rounded-xl">
              <div className="max-h-[340px] overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No active clients found on this router.
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b border-border/60 text-3xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="py-2 pl-3">Device / Hostname</th>
                        <th className="py-2">IP Address</th>
                        <th className="py-2">MAC Address</th>
                        <th className="py-2">Signal / Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono text-2xs">
                      {filteredClients.map((c, i) => {
                        const Icon = getDeviceIcon(c);
                        const sig = getSignalQuality(c.signal_dbm);
                        const isCopied = copiedMac === c.mac;
                        return (
                          <tr key={i} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2 pl-3">
                              <div className="flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="font-sans font-medium text-foreground truncate max-w-[150px]">
                                  {c.hostname || 'Unknown Device'}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 text-muted-foreground">{c.ip || '—'}</td>
                            <td className="py-2">
                              <button
                                onClick={() => copyToClipboard(c.mac, c.mac)}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group"
                                title="Click to copy MAC"
                              >
                                <span>{c.mac}</span>
                                {isCopied ? (
                                  <Check className="h-3 w-3 text-ok" />
                                ) : (
                                  <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                )}
                              </button>
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-1.5">
                                <span className={cn('h-1.5 w-1.5 rounded-full', sig.color)} />
                                <span className={cn('font-semibold', sig.color)}>
                                  {c.signal_dbm ? `${c.signal_dbm} dBm` : 'Wired'}
                                </span>
                                {c.tx_rate_mbps && (
                                  <span className="text-3xs text-muted-foreground">
                                    ({c.tx_rate_mbps.toFixed(0)} Mbps)
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: System & Hardware */}
        {activeTab === 'system' && (
          <div className="space-y-4">
            {/* Router Hardware Health */}
            <div className="mat-well p-3.5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {system.model} Hardware Metrics
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-2xs">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5 text-brand" />
                      CPU Load · Avg: {system.load_average.map((l) => l.toFixed(2)).join(' ')}
                    </span>
                    <span className="font-mono tabular text-foreground">
                      {system.cpu_usage_percent.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={system.cpu_usage_percent} height="sm" />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-2xs">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <MemoryStick className="h-3.5 w-3.5 text-brand" />
                      System RAM
                    </span>
                    <span className="font-mono tabular text-foreground">
                      {formatBytes(system.memory.used_bytes)} / {formatBytes(system.memory.total_bytes)} (
                      {system.memory.used_percent.toFixed(0)}%)
                    </span>
                  </div>
                  <Progress value={system.memory.used_percent} height="sm" />
                </div>

                {ap && (
                  <div className="mt-3 rounded-lg bg-card/60 p-2.5 text-2xs font-mono text-muted-foreground">
                    Bridge Device: <strong className="text-foreground">{ap.bridge_dev}</strong> · Upstream Gateway:{' '}
                    <strong className="text-foreground">{ap.upstream_ip}</strong> · Status:{' '}
                    <strong className={ap.upstream_reachable ? 'text-ok' : 'text-crit'}>
                      {ap.upstream_reachable ? 'Connected (1Gbps Link)' : 'Unreachable'}
                    </strong>
                  </div>
                )}
              </div>
            </div>

            {/* AdGuard if present */}
            {adguard && (
              <div className="mat-well p-3.5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    AdGuard Home & DNS Shield
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium',
                      dnsOk ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit'
                    )}
                  >
                    {dnsOk ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                    {dnsOk ? 'Active & Filtering' : 'Offline'}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-card/60 p-2.5 dark:bg-black/30">
                    <div className="text-3xs uppercase text-muted-foreground">DNS Port 53 UDP</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-foreground">
                      {adguard.port53_udp ? 'Listening (OK)' : 'Unreachable'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-card/60 p-2.5 dark:bg-black/30">
                    <div className="text-3xs uppercase text-muted-foreground">DNS Port 53 TCP</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-foreground">
                      {adguard.port53_tcp ? 'Listening (OK)' : 'Unreachable'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
