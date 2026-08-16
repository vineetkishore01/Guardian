import React, { useState } from 'react';
import { Activity, RefreshCw, CheckCircle2, AlertCircle, ShieldAlert, ExternalLink, Globe } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
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
    <Card className="glass-card-static border-white/10 overflow-hidden">
      <div className="p-4 sm:p-5 flex items-center justify-between border-b border-white/10 bg-slate-950/40">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">Service Health & Latency Prober</h3>
              <Badge variant="secondary" className="text-[10px]">
                {probes.length} endpoints
              </Badge>
            </div>
            <p className="text-[11px] text-slate-400">
              Monitors host web services and container endpoints (60s cycle, 3s timeout)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setCollapsed(!collapsed)}
            className="text-xs text-slate-400 hover:text-white"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </Button>
          <Button
            variant="secondary"
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
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-white/5 font-semibold font-mono">
              <tr>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Endpoint</th>
                <th className="px-4 py-2.5">Status Code</th>
                <th className="px-4 py-2.5">Latency</th>
                <th className="px-4 py-2.5 text-right">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {probes.map((probe) => {
                const isUp = probe.status !== 'down';
                const url = `http://${activeHost}:${probe.port}`;

                return (
                  <tr
                    key={probe.name}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 font-sans font-bold text-slate-200">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isUp ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-rose-500'
                          }`}
                        />
                        <span>{probe.name}</span>
                        {probe.notes && (
                          <span className="text-[10px] text-slate-500 font-normal">
                            ({probe.notes})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        :{probe.port}
                        <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {probe.statusCode ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            probe.statusCode === 200
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : probe.statusCode === 401 || probe.statusCode === 403
                              ? 'bg-blue-500/20 text-blue-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {probe.statusCode} {probe.statusCode === 401 ? 'Auth' : probe.statusCode === 403 ? 'Forbidden' : probe.statusCode === 302 ? 'Redirect' : 'OK'}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-bold">
                          ERR
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {probe.latencyMs ? `${probe.latencyMs} ms` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
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
