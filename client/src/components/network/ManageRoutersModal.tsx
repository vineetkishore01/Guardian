import { useState, useEffect } from 'react';
import {
  Router,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Radio,
  Network,
  Shield,
  Key,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { RouterConfig, RouterRole } from '../../types/dashboard';

interface ManageRoutersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoutersChanged?: () => void;
}

export function ManageRoutersModal({
  open,
  onOpenChange,
  onRoutersChanged,
}: ManageRoutersModalProps) {
  const [configs, setConfigs] = useState<RouterConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(80);
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<RouterRole>('ap');

  // Probe state
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    model?: string;
    hostname?: string;
    release?: string;
    error?: string;
  } | null>(null);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/routers');
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchConfigs();
      setProbeResult(null);
    }
  }, [open]);

  const handleProbe = async () => {
    if (!host.trim()) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch('/api/routers/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: Number(port) || 80,
          username: username.trim() || 'root',
          password: password,
          role,
        }),
      });
      const data = await res.json();
      setProbeResult(data);
    } catch (err) {
      setProbeResult({ ok: false, error: (err as Error).message });
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim() || !label.trim()) return;

    const id = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `router-${Date.now()}`;

    try {
      setLoading(true);
      const res = await fetch('/api/routers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          label: label.trim(),
          host: host.trim(),
          port: Number(port) || 80,
          username: username.trim() || 'root',
          password: password,
          role,
          enabled: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      // Reset form
      setLabel('');
      setHost('');
      setPassword('');
      setProbeResult(null);

      await fetchConfigs();
      onRoutersChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this router from Guardian?')) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/routers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchConfigs();
        onRoutersChanged?.();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage Router Fleet"
      description="Plug-and-play agentless monitoring for your OpenWrt routers. Guardian probes native /ubus over HTTP without any installed binaries."
      maxWidth="2xl"
    >
      <div className="space-y-6 py-2">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-crit/10 p-3 text-xs text-crit">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Existing Routers List */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Configured Routers ({configs.length})
          </h4>
          <div className="space-y-2">
            {configs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
                No routers configured yet. Add your first router below.
              </div>
            ) : (
              configs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-brand">
                      {r.role === 'gateway' ? <Network className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{r.label}</span>
                        <span className="rounded bg-brand/10 px-1.5 py-0.5 text-3xs font-medium uppercase text-brand">
                          {r.role}
                        </span>
                      </div>
                      <div className="font-mono text-3xs text-muted-foreground">
                        http://{r.host}:{r.port || 80}/ubus · user: {r.username}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-crit/10 hover:text-crit transition-colors"
                    title="Remove router"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Add New Router Form */}
        <div className="rounded-2xl border border-border/80 bg-muted/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4 text-brand" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Onboard New Router (Agentless)
            </h4>
          </div>

          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-2xs font-medium text-muted-foreground">
                  Display Label *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bedroom (JioRouter AX6000)"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-2xs font-medium text-muted-foreground">
                  Router Role *
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as RouterRole)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                >
                  <option value="ap">Access Point / Dumb AP / Mesh Node</option>
                  <option value="gateway">Primary Gateway (WAN / Multi-WAN)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-2xs font-medium text-muted-foreground">
                  IP Address / Hostname *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 192.168.0.2"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-2xs font-medium text-muted-foreground">
                  HTTP Port
                </label>
                <input
                  type="number"
                  placeholder="80"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 80)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-2xs font-medium text-muted-foreground">
                  Username
                </label>
                <input
                  type="text"
                  placeholder="root"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-2xs font-medium text-muted-foreground">
                  LuCI / Root Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            {/* Probe Feedback */}
            {probing && (
              <div className="flex items-center gap-2 rounded-lg bg-card p-2 text-2xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                <span>Probing native OpenWrt /ubus at http://{host}:{port}/ubus...</span>
              </div>
            )}

            {probeResult && (
              <div
                className={`flex items-start gap-2 rounded-lg p-2.5 text-2xs ${
                  probeResult.ok ? 'bg-ok/10 text-ok' : 'bg-crit/10 text-crit'
                }`}
              >
                {probeResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <div>
                  <div className="font-semibold">
                    {probeResult.ok ? 'Connection Verified!' : 'Connection Probe Failed'}
                  </div>
                  {probeResult.ok && (
                    <div className="text-muted-foreground mt-0.5">
                      Model: <span className="font-semibold text-foreground">{probeResult.model}</span> · OS:{' '}
                      <span className="font-semibold text-foreground">{probeResult.release}</span>
                    </div>
                  )}
                  {probeResult.error && <div>{probeResult.error}</div>}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || !host.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
              >
                {probing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3 text-brand" />}
                Test Connection
              </button>

              <button
                type="submit"
                disabled={loading || !host.trim() || !label.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Save Router
              </button>
            </div>
          </form>
        </div>
      </div>
    </Dialog>
  );
}
