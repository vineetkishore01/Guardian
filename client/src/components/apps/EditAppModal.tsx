import React, { useState, useEffect } from 'react';
import {
  Search,
  Sparkles,
  Link,
  Tag,
  EyeOff,
  Pin,
  Check,
  Globe,
  Layers,
  Image as ImageIcon,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { ContainerItem, CustomAppBookmark } from '../../types/dashboard';
import { ICON_PRESETS, IconPreset } from '../../lib/iconPresets';

interface EditAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ContainerItem | CustomAppBookmark | null;
  isCustomBookmark?: boolean;
  onSaveContainer: (name: string, updates: Partial<ContainerItem>) => Promise<boolean>;
  onSaveBookmark: (bookmark: CustomAppBookmark) => Promise<boolean>;
}

const CATEGORIES = ['Media', 'Downloads', 'Automation', 'Productivity', 'Development', 'AI & Tools', 'System', 'Utilities'];

export function EditAppModal({
  open,
  onOpenChange,
  item,
  isCustomBookmark = false,
  onSaveContainer,
  onSaveBookmark,
}: EditAppModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [category, setCategory] = useState('Media');
  const [pinned, setPinned] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [description, setDescription] = useState('');

  const [searchPreset, setSearchPreset] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'presets'>('details');

  useEffect(() => {
    if (item) {
      const container = !isCustomBookmark ? (item as ContainerItem) : null;
      const bookmark = isCustomBookmark ? (item as CustomAppBookmark) : null;

      setDisplayName(container?.displayName || item.name || '');
      setIconUrl(item.iconUrl || '');
      setCustomUrl(container?.customUrl || bookmark?.url || '');
      setCategory(item.category || 'Media');
      setPinned(item.pinned ?? false);
      setHidden(container?.hidden ?? false);
      setDescription(bookmark?.description || '');
      setSearchPreset('');
      setActiveTab('details');
    }
  }, [item, isCustomBookmark]);

  if (!item) return null;

  const handleApplyPreset = (preset: IconPreset) => {
    setIconUrl(preset.iconUrl);
    setCategory(preset.category);
    if (!displayName || displayName === item.name) {
      setDisplayName(preset.name);
    }
    setActiveTab('details');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isCustomBookmark) {
        await onSaveBookmark({
          id: (item as CustomAppBookmark).id,
          name: displayName,
          url: customUrl,
          iconUrl: iconUrl || undefined,
          category,
          pinned,
          description,
        });
      } else {
        await onSaveContainer(item.name, {
          displayName,
          iconUrl: iconUrl || undefined,
          customUrl: customUrl || undefined,
          category,
          pinned,
          hidden,
        });
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const filteredPresets = ICON_PRESETS.filter((p) => {
    const q = searchPreset.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.keywords.some((k) => k.toLowerCase().includes(q))
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Customize: ${item.name}`}
      description="Configure custom icon, launch URL, categories, and visibility"
      maxWidth="lg"
    >
      {/* Sub tabs */}
      <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'details'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          App Configuration
        </button>
        <button
          onClick={() => setActiveTab('presets')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
            activeTab === 'presets'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
          Choose from 60+ Preset Icons
        </button>
      </div>

      {activeTab === 'details' ? (
        <div className="space-y-4">
          {/* Icon Preview + URL Row */}
          <div className="flex items-start gap-4 p-3.5 rounded-xl bg-slate-950/60 border border-white/10">
            <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div className="flex items-center justify-center h-14 w-14 rounded-xl bg-slate-800 border border-white/15 p-2 shadow-inner">
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt="Preview"
                    className="h-full w-full object-contain filter drop-shadow"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-slate-500" />
                )}
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Preview</span>
            </div>

            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Icon URL (SVG, PNG, WebP)</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('presets')}
                  className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <Sparkles className="h-3 w-3" /> Select preset
                </button>
              </label>
              <Input
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://.../icon.svg or paste image link"
              />
              <p className="text-[11px] text-slate-500">
                Tip: Paste any direct link to an SVG or PNG logo.
              </p>
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Display Title</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jellyfin Media Server"
            />
          </div>

          {/* Custom Launch URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Custom Launch URL</span>
              <span className="text-[11px] text-slate-500 font-mono">
                Supports {'{host}'}, {'{lan}'}, {'{tailscale}'}
              </span>
            </label>
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="http://{host}:8096 or https://jellyfin.yourdomain.com"
            />
            <p className="text-[11px] text-slate-500">
              Leave blank to automatically launch on the container's published port with the active server IP.
            </p>
          </div>

          {/* Category Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Category Tag</label>
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

          {/* Description (if custom bookmark) */}
          {isCustomBookmark && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this web app"
              />
            </div>
          )}

          {/* Toggles: Pin to top & Hide */}
          <div className="pt-2 flex items-center gap-6 border-t border-white/10">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
              />
              <span className="flex items-center gap-1">
                <Pin className="h-3.5 w-3.5 text-cyan-400" />
                Pin to top
              </span>
            </label>

            {!isCustomBookmark && (
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
                />
                <span className="flex items-center gap-1 text-slate-400 hover:text-slate-300">
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide from grid
                </span>
              </label>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      ) : (
        /* Presets Gallery Tab */
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchPreset}
              onChange={(e) => setSearchPreset(e.target.value)}
              placeholder="Search 60+ apps (e.g. Jellyfin, Sonarr, Home Assistant, VS Code...)"
              className="pl-9"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
            {filteredPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/60 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/40 text-left transition-all group"
              >
                <div className="flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg bg-slate-800 p-1.5">
                  <img
                    src={preset.iconUrl}
                    alt={preset.name}
                    className="h-full w-full object-contain filter drop-shadow group-hover:scale-110 transition-transform"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-200 truncate group-hover:text-cyan-300">
                    {preset.name}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{preset.category}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-white/10">
            <span className="text-xs text-slate-400">
              Showing {filteredPresets.length} presets
            </span>
            <Button variant="outline" size="sm" onClick={() => setActiveTab('details')}>
              Back to Editor
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
