import React, { useState, useMemo } from 'react';
import { RefreshCw, ExternalLink, ChevronDown } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ServiceProbeResult, DashboardSettings } from '../../types/dashboard';
import { getActiveHost, cn, formatAgo } from '../../lib/utils';

interface ServicesTableProps {
  probes?: ServiceProbeResult[];
  settings?: DashboardSettings;
  onRefreshProbes: () => Promise<ServiceProbeResult[]>;
}

/** Honest label for an HTTP status. Previously anything that was not 401/403/302
 *  rendered as "OK", so a 500 displayed as "500 OK". */
function describeStatus(code: number | null): { text: string; tone: 'ok' | 'warn' | 'crit' } {
  if (code === null) return { text: 'No response', tone: 'crit' };
  if (code >= 200 && code < 300) return { text: 'OK', tone: 'ok' };
  if (code === 401) return { text: 'Auth required', tone: 'warn' };
  if (code === 403) return { text: 'Forbidden', tone: 'warn' };
  if (code >= 300 && code < 400) return { text: 'Redirect', tone: 'ok' };
  if (code >= 400 && code < 500) return { text: 'Client error', tone: 'warn' };
  return { text: 'Server error', tone: 'crit' };
}

function latencyTone(ms: number | null): string {
  if (ms === null) return 'text-muted-foreground';
  if (ms < 200) return 'text-foreground';
  if (ms < 1000) return 'text-warn';
  return 'text-crit';
}

export function ServicesTable({ probes = [], settings, onRefreshProbes }: ServicesTableProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const activeHost = getActiveHost(settings);

  const { reachable, lastChecked } = useMemo(
    () => ({
      reachable: probes.filter((p) => p.status !== 'down').length,
      lastChecked: probes.reduce((max, p) => Math.max(max, p.lastChecked || 0), 0),
    }),
    [probes]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshProbes();
    } finally {
      setRefreshing(false);
    }
  };

  const allUp = probes.length > 0 && reachable === probes.length;

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90'
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">Endpoint health</h3>
            <p className="truncate text-2xs text-muted-foreground">
              {probes.length > 0 ? (
                <>
                  <span className={allUp ? 'text-ok' : 'text-warn'}>
                    {reachable}/{probes.length} reachable
                  </span>
                  {lastChecked > 0 && ` · checked ${formatAgo(lastChecked)}`}
                </>
              ) : (
                'No endpoints configured'
              )}
            </p>
          </div>
        </button>

        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} aria-hidden="true" />
          <span className="hidden sm:inline">{refreshing ? 'Probing…' : 'Re-probe'}</span>
        </Button>
      </div>

      {!collapsed && probes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border text-2xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Service</th>
                <th scope="col" className="px-4 py-2 font-medium">Port</th>
                <th scope="col" className="px-4 py-2 font-medium">Response</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {probes.map((probe) => {
                const isUp = probe.status !== 'down';
                const status = describeStatus(probe.statusCode ?? null);
                const url = `http://${activeHost}:${probe.port}`;

                return (
                  <tr key={`${probe.name}:${probe.port}`} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            isUp ? 'bg-ok' : 'bg-crit'
                          )}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-foreground">{probe.name}</span>
                        {probe.notes && (
                          <span className="hidden truncate text-2xs text-muted-foreground sm:inline">
                            {probe.notes}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-2.5">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-brand"
                      >
                        {probe.port}
                        <ExternalLink className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
                      </a>
                    </td>

                    <td className="px-4 py-2.5">
                      <Badge variant={status.tone}>
                        {probe.statusCode !== null && probe.statusCode !== undefined && (
                          <span className="font-mono">{probe.statusCode}</span>
                        )}
                        {status.text}
                      </Badge>
                    </td>

                    <td
                      className={cn(
                        'px-4 py-2.5 text-right font-mono',
                        latencyTone(probe.latencyMs ?? null)
                      )}
                    >
                      {probe.latencyMs !== null && probe.latencyMs !== undefined
                        ? `${probe.latencyMs} ms`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
