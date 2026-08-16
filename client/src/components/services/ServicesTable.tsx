import React, { useState } from 'react';
import { Activity, RefreshCw, ExternalLink } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ServiceProbeResult, DashboardSettings } from '../../types/dashboard';
import { getActiveHost } from '../../lib/utils';

interface ServicesTableProps {
  probes?: ServiceProbeResult[];
  settings?: DashboardSettings;
  onRefreshProbes: () => Promise<ServiceProbeResult[]>;
}

export function ServicesTable({ probes = [], settings, onRefreshProbes }: ServicesTableProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshProbes();
    } finally {
      setRefreshing(false);
    }
  };

  const activeHost = getActiveHost(settings);

  return (
    <Card className="border-border overflow-hidden">
      <div className="p-3.5 sm:p-4 flex items-center justify-between border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-secondary text-foreground border border-border">
            <Activity className="h-4 w-4 text-sky-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Service Health & Latency Prober</h3>
              <Badge variant="secondary" className="text-[10px]">
                {probes.length} endpoints
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Monitors host web services & container endpoints (60s cycle, 3s timeout)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setCollapsed(!collapsed)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Re-Probe</span>
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border font-medium font-mono">
              <tr>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Endpoint</th>
                <th className="px-4 py-2.5">Status Code</th>
                <th className="px-4 py-2.5">Latency</th>
                <th className="px-4 py-2.5 text-right">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {probes.map((probe) => {
                const isUp = probe.status !== 'down';
                const url = `http://${activeHost}:${probe.port}`;

                return (
                  <tr
                    key={probe.name}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-sans font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isUp ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-rose-500'
                          }`}
                        />
                        <span>{probe.name}</span>
                        {probe.notes && (
                          <span className="text-[10px] text-muted-foreground font-normal">
                            ({probe.notes})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-mono"
                      >
                        :{probe.port}
                        <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                      </a>
                    </td>
                    <td className="px-4 py-2.5">
                      {probe.statusCode ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            probe.statusCode === 200
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : probe.statusCode === 401 || probe.statusCode === 403
                              ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {probe.statusCode} {probe.statusCode === 401 ? 'Auth' : probe.statusCode === 403 ? 'Forbidden' : probe.statusCode === 302 ? 'Redirect' : 'OK'}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold border border-rose-500/20">
                          ERR
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {probe.latencyMs ? `${probe.latencyMs} ms` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-sans">
                      {isUp ? (
                        <Badge variant="success" className="text-[10px]">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">
                          Unreachable
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
