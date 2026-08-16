import React, { useState, useMemo } from 'react';
import { Search, AlertCircle } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input, Field } from '../ui/Input';
import { CustomAppBookmark } from '../../types/dashboard';
import { ICON_PRESETS, IconPreset } from '../../lib/iconPresets';
import { cn } from '../../lib/utils';

interface AddAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddBookmark: (bookmark: Partial<CustomAppBookmark>) => Promise<boolean>;
}

const CATEGORIES = [
  'System',
  'Media',
  'Downloads',
  'Automation',
  'Productivity',
  'Development',
  'AI & Tools',
  'Utilities',
];

export function AddAppModal({ open, onOpenChange, onAddBookmark }: AddAppModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [category, setCategory] = useState('System');
  const [description, setDescription] = useState('');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [presetQuery, setPresetQuery] = useState('');

  const matchingPresets = useMemo(() => {
    const q = presetQuery.toLowerCase().trim();
    const pool = q
      ? ICON_PRESETS.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            p.keywords.some((k) => k.toLowerCase().includes(q))
        )
      : ICON_PRESETS;
    return pool.slice(0, 12);
  }, [presetQuery]);

  const reset = () => {
    setName('');
    setUrl('');
    setIconUrl('');
    setCategory('System');
    setDescription('');
    setPinned(false);
    setPresetQuery('');
    setSubmitError(null);
  };

  const applyPreset = (preset: IconPreset) => {
    if (!name.trim()) setName(preset.name);
    setIconUrl(preset.iconUrl);
    setCategory(preset.category);
    if (!url.trim() && preset.defaultPort) setUrl(`http://{host}:${preset.defaultPort}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const ok = await onAddBookmark({
        name: name.trim(),
        url: url.trim(),
        iconUrl: iconUrl.trim() || undefined,
        category,
        description: description.trim() || undefined,
        pinned,
      });

      if (ok) {
        reset();
        onOpenChange(false);
      } else {
        setSubmitError('Could not add the bookmark. The server rejected the request.');
      }
    } catch (err) {
      setSubmitError((err as Error).message || 'Could not add the bookmark.');
    } finally {
      setSubmitting(false);
    }
  };

  const formId = 'add-bookmark-form';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Add bookmark"
      description="A launcher tile for anything not managed by Docker"
      maxWidth="md"
      footer={
        <>
          {submitError && (
            <span className="mr-auto flex items-center gap-1.5 text-2xs text-crit" role="alert">
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {submitError}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            size="sm"
            type="submit"
            form={formId}
            disabled={submitting || !name.trim() || !url.trim()}
          >
            {submitting ? 'Adding…' : 'Add bookmark'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" htmlFor="bookmark-name">
          <Input
            id="bookmark-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Router admin"
            required
          />
        </Field>

        <Field
          label="URL"
          htmlFor="bookmark-url"
          hint="{host} resolves to the active launch target from Settings."
        >
          <Input
            id="bookmark-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://{host}:3000"
            required
          />
        </Field>

        <Field label="Icon" hint="Pick a preset to fill in the icon, category and default port.">
          <div className="space-y-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={presetQuery}
                onChange={(e) => setPresetQuery(e.target.value)}
                placeholder="Search presets"
                className="pl-8"
              />
            </div>

            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto pr-1">
              {matchingPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'flex items-center gap-2 truncate rounded-md border p-1.5 text-left text-xs transition-colors',
                    iconUrl === preset.iconUrl
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-transparent text-foreground hover:border-border hover:bg-accent'
                  )}
                >
                  <img src={preset.iconUrl} alt="" className="h-4 w-4 shrink-0 object-contain" loading="lazy" />
                  <span className="truncate">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>
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

        <Field label="Description" htmlFor="bookmark-desc">
          <Input
            id="bookmark-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <label className="flex cursor-pointer select-none items-center gap-2.5 border-t border-border pt-3.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-brand"
          />
          Pin to the top of the grid
        </label>
      </form>
    </Dialog>
  );
}
