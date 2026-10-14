import { useState, useMemo } from 'react';
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
  RouterTelemetryPayload,
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
  data: RouterTelemetryPayload;
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

export function RouterDetailModal({ open, onOpenChange, data }: RouterDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'uplinks' | 'clients' | 'system'>('uplinks');
  const [searchQuery, setSearchQuery] = useState('');
  const [bandFilter, setBandFilter] = useState<'all' | '5ghz' | '2.4ghz' | 'wired'>('all');
  const [copiedMac, setCopiedMac] = useState<string | null>(null);

  const { system, multi_wan: mwan, wifi, adguard } = data;
  const wans = [...mwan.interfaces].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const bandwidth = [...data.isp_bandwidth].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const dnsOk = adguard.dns_responding || adguard.port53_udp;
  const clients = wifi.clients || [];

  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      // Band filter
      if (bandFilter === '5ghz' && !c.connection_type.includes('5 GHz')) return false;
      if (bandFilter === '2.4ghz' && !c.connection_type.includes('2.4 GHz')) return false;
      if (bandFilter === 'wired' && !c.connection_type.includes('Wired')) return false;

      // Search query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (c.hostname && c.hostname.toLowerCase().includes(q)) ||
        (c.ip && c.ip.toLowerCase().includes(q)) ||
        (c.mac && c.mac.toLowerCase().includes(q)) ||
        (c.connection_type && c.connection_type.toLowerCase().includes(q))
      );
    });
  }, [clients, searchQuery, bandFilter]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMac(id);
    setTimeout(() => setCopiedMac(null), 2000);
  };

  const tabs: TabItem[] = [
    { id: 'uplinks', label: 'Uplinks & Traffic', icon: <Cable className="h-3.5 w-3.5" /> },
    {
      id: 'clients',
      label: 'Connected Devices',
      count: clients.length || wifi.total_clients,
      icon: <Wifi className="h-3.5 w-3.5" />,
    },
    { id: 'system', label: 'Hardware & Security', icon: <Cpu className="h-3.5 w-3.5" /> },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${system.model} · Network Intelligence`}
      description={`${system.hostname} · OpenWrt Linux ${system.kernel} · Uptime ${formatUptime(system.uptime_secs)}`}
      maxWidth="3xl"
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="border-b border-border/60 pb-3">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />
        </div>

        {/* TAB 1: Uplinks & Traffic */}
        {activeTab === 'uplinks' && (
          <div className="space-y-4">
            {/* Multi-WAN Interface Grid */}
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

                    {/* Live Throughput */}
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

                    {/* Interface Details */}
                    <div className="mt-3 flex items-center justify-between text-2xs text-muted-foreground">
                      <span>Device: {wan.device}</span>
                      <span className="font-mono tabular">
                        {wan.online
                          ? wan.latency_ms !== null
                            ? `${wan.latency_ms.toFixed(1)} ms latency`
                            : 'Connected'
                          : wan.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ISP Bandwidth Accounting */}
            <div className="mat-well p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  ISP Bandwidth Accounting (vnStat)
                </span>
                <span className="font-mono text-3xs text-muted-foreground">Persistent on USB</span>
              </div>
              {bandwidth.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {bandwidth.map((bw) => (
                    <div key={bw.interface} className="flex items-center justify-between py-2 text-xs">
                      <div>
                        <div className="font-medium text-foreground">{bw.label}</div>
                        <div className="font-mono text-3xs text-muted-foreground">
                          {bw.role.toUpperCase()} · {bw.interface}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-right font-mono text-2xs tabular">
                        <div>
                          <div className="text-3xs text-muted-foreground">Today Total</div>
                          <div className="font-semibold text-foreground">
                            {formatBytes(bw.today_rx_bytes + bw.today_tx_bytes)}
                          </div>
                          <div className="text-3xs text-muted-foreground">
                            ↓ {formatBytes(bw.today_rx_bytes)} · ↑ {formatBytes(bw.today_tx_bytes)}
                          </div>
                        </div>
                        <div>
                          <div className="text-3xs text-muted-foreground">This Month</div>
                          <div className="font-semibold text-foreground">
                            {formatBytes(bw.month_rx_bytes + bw.month_tx_bytes)}
                          </div>
                          <div className="text-3xs text-muted-foreground">
                            ↓ {formatBytes(bw.month_rx_bytes)} · ↑ {formatBytes(bw.month_tx_bytes)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  Bandwidth history collecting on external USB...
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Connected Devices (Inventory) */}
        {activeTab === 'clients' && (
          <div className="space-y-3">
            {/* Search & Filter Toolbar */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search hostname, IP, MAC address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border/70 bg-card/60 py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand dark:bg-black/30"
                />
              </div>
              <div className="flex items-center gap-1 text-2xs">
                {(['all', '5ghz', '2.4ghz', 'wired'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setBandFilter(filter)}
                    className={cn(
                      'rounded-md px-2.5 py-1 font-medium transition-colors',
                      bandFilter === filter
                        ? 'bg-brand text-brand-foreground shadow-sm'
                        : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {filter === 'all'
                      ? `All (${clients.length})`
                      : filter === '5ghz'
                      ? '5 GHz'
                      : filter === '2.4ghz'
                      ? '2.4 GHz'
                      : 'Wired'}
                  </button>
                ))}
              </div>
            </div>

            {/* Client List */}
            {filteredClients.length > 0 ? (
              <div className="mat-well max-h-[50vh] divide-y divide-border/40 overflow-y-auto rounded-lg">
                {filteredClients.map((client) => {
                  const DeviceIcon = getDeviceIcon(client);
                  const is5G = client.connection_type.includes('5 GHz');
                  const isWired = client.connection_type.includes('Wired');
                  const signal = getSignalQuality(client.signal_dbm);

                  return (
                    <div
                      key={client.mac}
                      className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/30"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50',
                            is5G
                              ? 'bg-brand/10 text-brand'
                              : isWired
                              ? 'bg-ok/10 text-ok'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <DeviceIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {client.hostname || 'Unknown Device'}
                            </span>
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-3xs font-medium',
                                is5G
                                  ? 'bg-brand/15 text-brand'
                                  : isWired
                                  ? 'bg-ok/15 text-ok'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {client.connection_type}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-3xs text-muted-foreground">
                            <span>{client.ip || 'No DHCP'}</span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              {client.mac}
                              <button
                                type="button"
                                onClick={() => copyToClipboard(client.mac, client.mac)}
                                className="text-muted-foreground/60 hover:text-foreground"
                                title="Copy MAC address"
                              >
                                {copiedMac === client.mac ? (
                                  <Check className="h-2.5 w-2.5 text-ok" />
                                ) : (
                                  <Copy className="h-2.5 w-2.5" />
                                )}
                              </button>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Signal & PHY Speed */}
                      <div className="flex shrink-0 items-center gap-4 text-right">
                        {!isWired && client.signal_dbm !== null && (
                          <div className="text-2xs">
                            <div className={cn('flex items-center justify-end gap-1 font-mono font-medium', signal.color)}>
                              <Signal className="h-3 w-3" />
                              <span>{client.signal_dbm} dBm</span>
                            </div>
                            <div className="text-3xs text-muted-foreground">{signal.label}</div>
                          </div>
                        )}
                        {client.tx_rate_mbps !== null && client.tx_rate_mbps !== undefined && (
                          <div className="text-2xs">
                            <div className="font-mono font-semibold tabular text-foreground">
                              {client.tx_rate_mbps} <span className="text-3xs text-muted-foreground">Mbps</span>
                            </div>
                            <div className="text-3xs text-muted-foreground">PHY Link</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mat-well p-8 text-center text-xs text-muted-foreground">
                No connected devices match your search or filter.
              </div>
            )}
          </div>
        )}

        {/* TAB 3: System & Security */}
        {activeTab === 'system' && (
          <div className="space-y-4">
            {/* Router Hardware Health */}
            <div className="mat-well p-3.5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                MediaTek MT7621AT Hardware Health
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-2xs">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5 text-brand" />
                      CPU Utilization · Load: {system.load_average.map((l) => l.toFixed(2)).join(' ')}
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

                {system.usb_storage && (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-2xs">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <HardDrive className="h-3.5 w-3.5 text-brand" />
                        External USB Storage ({system.usb_storage.mount})
                      </span>
                      <span className="font-mono tabular text-foreground">
                        {formatBytes(system.usb_storage.free_bytes)} free of{' '}
                        {formatBytes(system.usb_storage.total_bytes)}
                      </span>
                    </div>
                    <Progress value={system.usb_storage.used_percent} height="sm" />
                  </div>
                )}
              </div>
            </div>

            {/* AdGuard & Security Status */}
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
              <div className="grid gap-2 sm:grid-cols-3">
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
                <div className="rounded-lg bg-card/60 p-2.5 dark:bg-black/30">
                  <div className="text-3xs uppercase text-muted-foreground">NAND Flash Wear</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-ok">
                    Zero Wear (RAM/USB)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
