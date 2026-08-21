import React, { useState, useEffect, useMemo } from 'react';
import { Search, Image as ImageIcon, AlertCircle, RotateCcw, Loader2 } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input, Field } from '../ui/Input';
import { ContainerItem, CustomAppBookmark } from '../../types/dashboard';
import { ICON_PRESETS, IconPreset } from '../../lib/iconPresets';
import { cn } from '../../lib/utils';

interface EditAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ContainerItem | CustomAppBookmark | null;
  isCustomBookmark?: boolean;
  onSaveContainer: (name: string, updates: Partial<ContainerItem>) => Promise<boolean>;
  onSaveBookmark: (bookmark: CustomAppBookmark) => Promise<boolean>;
  onRestartContainer?: (container: ContainerItem) => Promise<boolean | void>;
}

const CATEGORIES = [
  'Media',
  'Downloads',
  'Automation',
  'Productivity',
  'Development',
  'AI & Tools',
  'System',
  'Utilities',
];

export function EditAppModal({
  open,
  onOpenChange,
  item,
  isCustomBookmark = false,
  onSaveContainer,
  onSaveBookmark,
  onRestartContainer,
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
  const [restarting, setRestarting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'icon'>('details');
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (!item) return;
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
    setSaveError(null);
    setPreviewFailed(false);
    setTab('details');
  }, [item, isCustomBookmark]);

  useEffect(() => setPreviewFailed(false), [iconUrl]);

  const filteredPresets = useMemo(() => {
    const q = searchPreset.toLowerCase().trim();
    if (!q) return ICON_PRESETS;
    return ICON_PRESETS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [searchPreset]);

  if (!item) return null;

  const applyPreset = (preset: IconPreset) => {
    setIconUrl(preset.iconUrl);
    setCategory(preset.category);
    if (!displayName || displayName === item.name) setDisplayName(preset.name);
    setTab('details');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const ok = isCustomBookmark
        ? await onSaveBookmark({
            id: (item as CustomAppBookmark).id,
            name: displayName.trim() || item.name,
            url: customUrl.trim(),
            iconUrl: iconUrl.trim() || undefined,
            category,
            pinned,
            description: description.trim() || undefined,
          })
        : await onSaveContainer(item.name, {
            displayName: displayName.trim() || item.name,
            iconUrl: iconUrl.trim() || undefined,
            customUrl: customUrl.trim() || undefined,
            category,
            pinned,
            hidden,
          });

      // Only dismiss once the write actually succeeded, so a failed save can
      // no longer look identical to a successful one.
      if (ok) {
        onOpenChange(false);
      } else {
        setSaveError('Could not save changes. The server rejected the request.');
      }
    } catch (err) {
      setSaveError((err as Error).message || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={displayName || item.name}
      description={isCustomBookmark ? 'Bookmark settings' : `Container · ${item.name}`}
      maxWidth="lg"
      footer={
        <>
          {!isCustomBookmark && onRestartContainer && (
            <Button
              variant="outline"
              size="sm"
              disabled={restarting || saving}
              onClick={async () => {
                setRestarting(true);
                setSaveError(null);
                try {
                  await onRestartContainer(item as ContainerItem);
                  onOpenChange(false);
                } catch (err) {
                  setSaveError((err as Error).message || 'Failed to restart container');
                } finally {
                  setRestarting(false);
                }
              }}
              className="mr-auto text-xs"
            >
              {restarting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Restarting…
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restart Container
                </>
              )}
            </Button>
          )}
          {saveError && (
            <span className="mr-auto flex items-center gap-1.5 text-2xs text-crit" role="alert">
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {saveError}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={handleSave} disabled={saving || restarting}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="mb-4 inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
        {(['details', 'icon'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t === 'details' ? 'Details' : 'Icon'}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-1.5">
              {iconUrl && !previewFailed ? (
                <img
                  src={iconUrl}
                  alt=""
                  className="h-full w-full object-contain"
                  onError={() => setPreviewFailed(true)}
                />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">
                {previewFailed ? 'Icon failed to load' : iconUrl ? 'Custom icon' : 'No icon set'}
              </p>
              <p className="truncate text-2xs text-muted-foreground">
                {previewFailed ? 'Check the URL is a direct image link.' : 'Pick one from the Icon tab.'}
              </p>
            </div>
            <Button variant="outline" size="xs" onClick={() => setTab('icon')}>
              Choose
            </Button>
          </div>

          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={item.name}
            />
          </Field>

          <Field
            label={isCustomBookmark ? 'Target URL' : 'Custom launch URL'}
            hint={
              isCustomBookmark
                ? 'Where this tile should open.'
                : 'Leave blank to use the published port on the active host.'
            }
            aside={
              <span className="font-mono text-2xs text-muted-foreground">
                {'{host}'} {'{lan}'} {'{tailscale}'}
              </span>
            }
          >
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="http://{host}:8096"
            />
          </Field>

          <Field label="Category">
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  aria-pressed={category === cat}
                  className={cn(
                    'rounded-md border px-2 py-1 text-2xs font-medium transition-colors',
                    category === cat
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </Field>

          {isCustomBookmark && (
            <Field label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          )}

          <div className="space-y-2.5 border-t border-border pt-3.5">
            <label className="flex cursor-pointer select-none items-center gap-2.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-brand"
              />
              Pin to the top of the grid
            </label>

            {!isCustomBookmark && (
              <label className="flex cursor-pointer select-none items-center gap-2.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input accent-brand"
                />
                Hide from the dashboard
              </label>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchPreset}
              onChange={(e) => setSearchPreset(e.target.value)}
              placeholder={`Search ${ICON_PRESETS.length} presets`}
              className="pl-8"
              autoFocus
            />
          </div>

          <Field label="Or paste a direct image URL">
            <Input
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              placeholder="https://…/icon.svg"
            />
          </Field>

          {filteredPresets.length > 0 ? (
            <div className="grid max-h-[300px] grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
              {filteredPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                    iconUrl === preset.iconUrl
                      ? 'border-brand bg-brand-soft'
                      : 'border-border bg-card hover:bg-accent'
                  )}
                >
                  <img
                    src={preset.iconUrl}
                    alt=""
                    className="h-6 w-6 shrink-0 object-contain"
                    loading="lazy"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {preset.name}
                    </span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {preset.category}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No presets match “{searchPreset}”.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
