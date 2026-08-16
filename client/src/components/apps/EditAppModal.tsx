import React, { useState, useEffect } from 'react';
import {
  Search,
  Sparkles,
  Pin,
  EyeOff,
  Image as ImageIcon,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
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
      <div className="flex items-center gap-1.5 mb-4 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
            activeTab === 'details'
              ? 'bg-secondary text-foreground font-semibold shadow-sm border border-border'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          App Configuration
        </button>
        <button
          onClick={() => setActiveTab('presets')}
          className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
            activeTab === 'presets'
              ? 'bg-secondary text-foreground font-semibold shadow-sm border border-border'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-sky-500" />
          Choose from 60+ Preset Icons
        </button>
      </div>

      {activeTab === 'details' ? (
        <div className="space-y-4">
          {/* Icon Preview + URL Row */}
          <div className="flex items-start gap-3.5 p-3 rounded-lg bg-secondary/40 border border-border">
            <div className="flex-shrink-0 flex flex-col items-center gap-1">
              <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-card border border-border p-2 shadow-sm">
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt="Preview"
                    className="h-full w-full object-contain filter drop-shadow-sm"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <span className="text-[10px] text-muted-foreground font-medium">Preview</span>
            </div>

            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Icon URL (SVG / PNG)</label>
                <button
                  type="button"
                  onClick={() => setActiveTab('presets')}
                  className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
                >
                  <Sparkles className="h-3 w-3" /> Select preset
                </button>
              </div>
              <Input
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://.../icon.svg or paste direct image link"
              />
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Display Title</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jellyfin Media Server"
            />
          </div>

          {/* Custom Launch URL */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">Custom Launch URL</label>
              <span className="text-[10px] text-muted-foreground font-mono">
                Supports {'{host}'}, {'{lan}'}, {'{tailscale}'}
              </span>
            </div>
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="http://{host}:8096 or https://jellyfin.domain.com"
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to automatically launch on the container's published port with the active server IP.
            </p>
          </div>

          {/* Category Selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Category</label>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    category === cat
                      ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                      : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Description (if custom bookmark) */}
          {isCustomBookmark && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this web shortcut"
              />
            </div>
          )}

          {/* Toggles: Pin to top & Hide */}
          <div className="pt-2 flex items-center gap-6 border-t border-border">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-foreground">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
              />
              <span className="flex items-center gap-1">
                <Pin className="h-3.5 w-3.5 text-sky-500" />
                Pin to top of grid
              </span>
            </label>

            {!isCustomBookmark && (
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-rose-500 focus:ring-rose-500"
                />
                <span className="flex items-center gap-1">
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide from dashboard
                </span>
              </label>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
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
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchPreset}
              onChange={(e) => setSearchPreset(e.target.value)}
              placeholder="Search 60+ apps (e.g. Jellyfin, Sonarr, Home Assistant, VS Code...)"
              className="pl-8"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[340px] overflow-y-auto pr-1">
            {filteredPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className="flex items-center gap-2.5 p-2 rounded-lg bg-card hover:bg-secondary border border-border text-left transition-all group"
              >
                <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-md bg-secondary p-1 border border-border">
                  <img
                    src={preset.iconUrl}
                    alt={preset.name}
                    className="h-full w-full object-contain filter drop-shadow-sm group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate group-hover:text-sky-600 dark:group-hover:text-sky-400">
                    {preset.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{preset.category}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs text-muted-foreground">
              {filteredPresets.length} presets available
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
