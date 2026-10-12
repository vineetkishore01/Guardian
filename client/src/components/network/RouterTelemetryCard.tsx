import { Router, Cable, Wifi, ArrowDown, ArrowUp, Cpu, MemoryStick, HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  RouterTelemetry,
  RouterWanInterface,
  RouterIspBandwidth,
  RouterWanRole,
} from '../../types/dashboard';
import { Progress } from '../ui/Progress';
import { cn, formatBytes, formatAgo, formatUptime } from '../../lib/utils';

interface RouterTelemetryCardProps {
  router: RouterTelemetry;
}

/** One uplink in the multi-WAN pill. Primary is wired fibre, backup is a Wi-Fi client link. */
function WanSegment({ wan, active }: { wan: RouterWanInterface; active: boolean }) {
  const Icon = wan.role === 'primary' ? Cable : Wifi;
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-1.5 transition-colors',
        active && 'bg-brand/15 ring-1 ring-brand/40'
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {wan.online && active && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', wan.online ? 'bg-ok' : 'bg-crit')} />
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-foreground">{wan.label}</div>
        <div className="truncate font-mono text-3xs text-muted-foreground">
          {wan.online ? (wan.latency_ms !== null ? `${wan.latency_ms.toFixed(1)} ms` : 'online') : wan.status}
          {active && ' · active'}
        </div>
      </div>
    </div>
  );
}

function BandwidthRow({ bw }: { bw: RouterIspBandwidth }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-foreground">{bw.label}</div>
        <div className="text-3xs uppercase tracking-wide text-muted-foreground">
          {bw.role === 'primary' ? 'Primary' : 'Backup'} · {bw.interface}
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-x-4 text-right font-mono text-2xs tabular">
        <span className="text-muted-foreground">Today</span>
        <span className="text-muted-foreground">Month</span>
        <span className="text-foreground">{formatBytes(bw.today_rx_bytes + bw.today_tx_bytes)}</span>
        <span className="text-foreground">{formatBytes(bw.month_rx_bytes + bw.month_tx_bytes)}</span>
        <span className="inline-flex items-center justify-end gap-0.5 text-3xs text-muted-foreground">
          <ArrowDown className="h-2.5 w-2.5" />
          {formatBytes(bw.today_rx_bytes)}
          <ArrowUp className="ml-1 h-2.5 w-2.5" />
          {formatBytes(bw.today_tx_bytes)}
        </span>
        <span className="inline-flex items-center justify-end gap-0.5 text-3xs text-muted-foreground">
          <ArrowDown className="h-2.5 w-2.5" />
          {formatBytes(bw.month_rx_bytes)}
          <ArrowUp className="ml-1 h-2.5 w-2.5" />
          {formatBytes(bw.month_tx_bytes)}
        </span>
      </div>
    </div>
  );
}

function Meter({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Cpu;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-2xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className="font-mono tabular text-foreground">{detail}</span>
      </div>
      <Progress value={value} height="xs" />
    </div>
  );
}

const ROLE_ORDER: Record<RouterWanRole, number> = { primary: 0, backup: 1 };

export function RouterTelemetryCard({ router }: RouterTelemetryCardProps) {
  const data = router.data;

  if (!data) {
    return (
      <div className="surface flex items-center gap-3 p-4">
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
  const bandwidth = [...data.isp_bandwidth].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const loadPercent = Math.min(100, (system.load_average[0] / Math.max(1, system.cpu_count)) * 100);
  const dnsOk = adguard.dns_responding || adguard.port53_udp;
  const apRadios = wifi.radios.filter((r) => r.mode === 'Master');

  return (
    <div className="surface p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Router className="h-4 w-4 text-brand" />
          <span className="truncate text-sm font-semibold text-foreground">{system.model}</span>
          <span className="truncate font-mono text-2xs text-muted-foreground">
            {system.hostname} · up {formatUptime(system.uptime_secs)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-2xs">
          {router.status === 'stale' && (
            <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">
              stale · {formatAgo(router.fetchedAt ?? undefined)}
            </span>
          )}
          {mwan.failover && (
            <span className="rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">Failover active</span>
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              dnsOk ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit'
            )}
            title={`AdGuard DNS :53 — tcp ${adguard.port53_tcp ? 'up' : 'down'}, udp ${adguard.port53_udp ? 'up' : 'down'}`}
          >
            {dnsOk ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
            AdGuard
          </span>
        </div>
      </div>

      {/* Multi-WAN pill */}
      <div className="mt-3 flex items-stretch gap-1 rounded-full bg-muted/50 p-1">
        {wans.map((w) => (
          <WanSegment key={w.name} wan={w} active={mwan.active === w.name} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* ISP bandwidth */}
        <div>
          <div className="tile-label mb-1">ISP Bandwidth</div>
          {bandwidth.length > 0 ? (
            <div className="divide-y divide-border/60">
              {bandwidth.map((bw) => (
                <BandwidthRow key={bw.interface} bw={bw} />
              ))}
            </div>
          ) : (
            <div className="py-2 text-2xs text-muted-foreground">vnStat data unavailable</div>
          )}
        </div>

        {/* Hardware + Wi-Fi */}
        <div className="space-y-2.5">
          <div className="tile-label">Router Hardware</div>
          <Meter
            icon={Cpu}
            label={`CPU · load ${system.load_average.map((l) => l.toFixed(2)).join(' ')}`}
            value={Math.max(system.cpu_usage_percent, loadPercent)}
            detail={`${system.cpu_usage_percent.toFixed(0)}%`}
          />
          <Meter
            icon={MemoryStick}
            label="RAM"
            value={system.memory.used_percent}
            detail={`${formatBytes(system.memory.used_bytes)} / ${formatBytes(system.memory.total_bytes)}`}
          />
          {system.usb_storage && (
            <Meter
              icon={HardDrive}
              label={`USB ${system.usb_storage.mount}`}
              value={system.usb_storage.used_percent}
              detail={`${formatBytes(system.usb_storage.used_bytes)} / ${formatBytes(system.usb_storage.total_bytes)}`}
            />
          )}
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Wifi className="h-3.5 w-3.5" />
              Wi-Fi 6 clients
            </span>
            <div className="flex items-baseline gap-2">
              <span className="tile-value tabular">{wifi.total_clients}</span>
              {apRadios.length > 0 && (
                <span className="font-mono text-3xs text-muted-foreground">
                  {apRadios.map((r) => `ch${r.channel ?? '?'}:${r.clients}`).join(' ')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
