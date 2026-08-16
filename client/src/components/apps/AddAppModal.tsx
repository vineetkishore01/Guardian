import React, { useState } from 'react';
import { Plus, Sparkles, Globe, Link, Image as ImageIcon } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CustomAppBookmark } from '../../types/dashboard';
import { ICON_PRESETS, IconPreset } from '../../lib/iconPresets';

interface AddAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddBookmark: (bookmark: Partial<CustomAppBookmark>) => Promise<boolean>;
}

const CATEGORIES = ['System', 'Media', 'Downloads', 'Automation', 'Productivity', 'Development', 'AI & Tools', 'Utilities'];

export function AddAppModal({ open, onOpenChange, onAddBookmark }: AddAppModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [category, setCategory] = useState('System');
  const [description, setDescription] = useState('');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) return;

    setSubmitting(true);
    try {
      const ok = await onAddBookmark({
        name,
        url,
        iconUrl: iconUrl || undefined,
        category,
        description: description || undefined,
        pinned,
      });
      if (ok) {
        setName('');
        setUrl('');
        setIconUrl('');
        setDescription('');
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectPreset = (preset: IconPreset) => {
    if (!name) setName(preset.name);
    setIconUrl(preset.iconUrl);
    setCategory(preset.category);
    if (!url && preset.defaultPort) {
      setUrl(`http://{host}:${preset.defaultPort}`);
    }
    setShowPresets(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Web App Bookmark"
      description="Create a quick launcher tile for any service (Docker, host port, router, or cloud)"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Preset quick picker toggle */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-500/20">
          <span className="text-xs text-cyan-200">Want to quickly populate a popular homelab app?</span>
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500"
          >
            <Sparkles className="h-3 w-3" />
            {showPresets ? 'Hide Presets' : 'Choose Preset'}
          </Button>
        </div>

        {showPresets && (
          <div className="p-3 rounded-xl bg-slate-950/80 border border-white/10 max-h-48 overflow-y-auto grid grid-cols-2 gap-2">
            {ICON_PRESETS.slice(0, 18).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900 hover:bg-cyan-500/20 border border-white/5 text-left text-xs text-slate-200 truncate transition-colors"
              >
                <img src={preset.iconUrl} alt={preset.name} className="h-5 w-5 object-contain" />
                <span className="truncate">{preset.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">App Name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CasaOS Host Portal, Router Admin, Proxmox..."
            required
          />
        </div>

        {/* URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>Target URL *</span>
            <span className="text-[10px] text-slate-500 font-mono">Supports {'{host}'}</span>
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://{host}:3000 or https://..."
            required
          />
        </div>

        {/* Icon URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Icon URL (SVG / PNG)</label>
          <Input
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://... or choose preset above"
          />
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  category === cat
                    ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/50'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-white/5'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Description (Optional)</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. CasaOS host dashboard on port 3000"
          />
        </div>

        {/* Pin to top */}
        <div className="pt-1">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
            />
            <span>Pin to top of the dashboard</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
          <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Bookmark'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
