import React, { useState, useEffect } from 'react';
import {
  Settings,
  Server,
  Network,
  Save,
  Download,
  Upload,
  RefreshCw,
  Info,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { DashboardSettings } from '../../types/dashboard';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings?: DashboardSettings;
  onSaveSettings: (settings: Partial<DashboardSettings>) => Promise<boolean>;
}

export function SettingsModal({
  open,
  onOpenChange,
  settings,
  onSaveSettings,
}: SettingsModalProps) {
  const [hostMode, setHostMode] = useState<DashboardSettings['defaultHostMode']>('auto');
  const [lanIp, setLanIp] = useState('192.168.0.26');
  const [tailscaleIp, setTailscaleIp] = useState('100.94.238.9');
  const [customHostUrl, setCustomHostUrl] = useState('');
  const [title, setTitle] = useState('Guardian Dashboard');
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setHostMode(settings.defaultHostMode || 'auto');
      setLanIp(settings.lanIp || '192.168.0.26');
      setTailscaleIp(settings.tailscaleIp || '100.94.238.9');
      setCustomHostUrl(settings.customHostUrl || '');
      setTitle(settings.title || 'Guardian Dashboard');
      setRefreshInterval(settings.refreshIntervalSec || 15);
    }
  }, [settings, open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings({
        defaultHostMode: hostMode,
        lanIp,
        tailscaleIp,
        customHostUrl: customHostUrl || undefined,
        title,
        refreshIntervalSec: Number(refreshInterval),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleExportConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guardian-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export configuration');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Guardian Dashboard Settings"
      description="Configure network IP resolution, refresh rates, and data persistence"
      maxWidth="md"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {/* Host Resolution Mode */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5 text-cyan-400" />
            Default App Launch IP Mode
          </label>
          <p className="text-[11px] text-slate-400">
            Select how Guardian builds the clickable application URLs when opening cards:
          </p>

          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'auto', title: 'Auto (Browser Host)', desc: 'Uses current browser URL' },
              { id: 'lan', title: 'LAN IP', desc: 'Direct 192.168.0.26' },
              { id: 'tailscale', title: 'Tailscale IP', desc: 'Direct 100.94.238.9' },
              { id: 'custom', title: 'Custom Domain', desc: 'Reverse proxy / domain' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setHostMode(opt.id as any)}
                className={`p-2.5 rounded-xl text-left border transition-all ${
                  hostMode === opt.id
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                    : 'bg-slate-950/60 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold text-slate-200">{opt.title}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* IP Addresses */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">LAN Host IP</label>
            <Input
              value={lanIp}
              onChange={(e) => setLanIp(e.target.value)}
              placeholder="192.168.0.26"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Tailscale IP</label>
            <Input
              value={tailscaleIp}
              onChange={(e) => setTailscaleIp(e.target.value)}
              placeholder="100.94.238.9"
            />
          </div>
        </div>

        {hostMode === 'custom' && (
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold text-slate-300">Custom Domain / Host</label>
            <Input
              value={customHostUrl}
              onChange={(e) => setCustomHostUrl(e.target.value)}
              placeholder="e.g. server.lan or https://homelab.mydomain.com"
            />
          </div>
        )}

        {/* Polling Interval */}
        <div className="space-y-1.5 pt-2 border-t border-white/10">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>Telemetry Polling Interval</span>
            <span className="text-[11px] text-cyan-400 font-mono">{refreshInterval} seconds</span>
          </label>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="w-full h-9 rounded-lg border border-white/10 bg-slate-950/60 px-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="15">15 seconds (Recommended — ultra-low CPU)</option>
            <option value="30">30 seconds (Minimal resource mode)</option>
            <option value="60">60 seconds (Battery/minimal)</option>
          </select>
        </div>

        {/* Backup / Export */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-200">Backup Configuration</div>
            <div className="text-[10px] text-slate-400">
              Export custom icon mappings & bookmarks JSON
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleExportConfig}
            className="flex items-center gap-1 text-xs"
          >
            <Download className="h-3 w-3" />
            <span>Export JSON</span>
          </Button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
          <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" size="sm" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
