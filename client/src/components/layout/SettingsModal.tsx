import React, { useState, useEffect } from 'react';
import { Download, AlertCircle } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input, Select, Field } from '../ui/Input';
import { DashboardSettings } from '../../types/dashboard';
import { cn } from '../../lib/utils';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings?: DashboardSettings;
  onSaveSettings: (settings: Partial<DashboardSettings>) => Promise<boolean>;
}

const HOST_MODES: Array<{
  id: NonNullable<DashboardSettings['defaultHostMode']>;
  title: string;
  desc: string;
}> = [
  { id: 'auto', title: 'Auto', desc: 'Whatever address you opened this page on' },
  { id: 'lan', title: 'LAN', desc: 'Always the LAN address below' },
  { id: 'tailscale', title: 'Tailscale', desc: 'Always the Tailscale address below' },
  { id: 'custom', title: 'Custom', desc: 'A domain or reverse proxy' },
];

export function SettingsModal({
  open,
  onOpenChange,
  settings,
  onSaveSettings,
}: SettingsModalProps) {
  const [hostMode, setHostMode] = useState<DashboardSettings['defaultHostMode']>('auto');
  const [lanIp, setLanIp] = useState('');
  const [tailscaleIp, setTailscaleIp] = useState('');
  const [customHostUrl, setCustomHostUrl] = useState('');
  const [title, setTitle] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waApiKey, setWaApiKey] = useState('');
  const [alertMinSeverity, setAlertMinSeverity] = useState<'warn' | 'crit'>('warn');
  const [alertCooldownMinutes, setAlertCooldownMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from server state whenever the dialog is opened, so a cancelled
  // edit never leaks into the next session.
  useEffect(() => {
    if (!open) return;
    setHostMode(settings?.defaultHostMode || 'auto');
    setLanIp(settings?.lanIp || '');
    setTailscaleIp(settings?.tailscaleIp || '');
    setCustomHostUrl(settings?.customHostUrl || '');
    setTitle(settings?.title || 'Guardian Dashboard');
    setRefreshInterval(settings?.refreshIntervalSec || 15);
    setTgToken(settings?.alertTelegramBotToken || '');
    setTgChatId(settings?.alertTelegramChatId || '');
    setWaPhone(settings?.alertWhatsappPhone || '');
    setWaApiKey(settings?.alertWhatsappApiKey || '');
    setAlertMinSeverity(settings?.alertMinSeverity || 'warn');
    setAlertCooldownMinutes(settings?.alertCooldownMinutes || 60);
    setError(null);
  }, [settings, open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const ok = await onSaveSettings({
        defaultHostMode: hostMode,
        lanIp: lanIp.trim() || undefined,
        tailscaleIp: tailscaleIp.trim() || undefined,
        customHostUrl: customHostUrl.trim() || undefined,
        title: title.trim() || 'Guardian Dashboard',
        refreshIntervalSec: Number(refreshInterval),
        /*
         * Sent as empty strings rather than undefined, so clearing a field
         * actually disables that channel instead of silently keeping the
         * previous credentials.
         */
        alertTelegramBotToken: tgToken.trim(),
        alertTelegramChatId: tgChatId.trim(),
        alertWhatsappPhone: waPhone.trim(),
        alertWhatsappApiKey: waApiKey.trim(),
        alertMinSeverity,
        alertCooldownMinutes: Number(alertCooldownMinutes),
      });
      if (ok) {
        onOpenChange(false);
      } else {
        setError('Could not save settings.');
      }
    } catch (err) {
      setError((err as Error).message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `guardian-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick; revoking synchronously can cancel the download
      // before the browser has read the blob.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(`Export failed: ${(err as Error).message}`);
    }
  };

  const formId = 'settings-form';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Launch targets, refresh rate and backup"
      maxWidth="md"
      footer={
        <>
          {error && (
            <span className="mr-auto flex items-center gap-1.5 text-2xs text-crit" role="alert">
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {error}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" type="submit" form={formId} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSave} className="space-y-5">
        <Field
          label="App launch target"
          hint="Determines the host used when building tile URLs and expanding {host}."
        >
          <div className="grid grid-cols-2 gap-1.5">
            {HOST_MODES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setHostMode(opt.id)}
                aria-pressed={hostMode === opt.id}
                className={cn(
                  'rounded-lg border p-2.5 text-left transition-colors',
                  hostMode === opt.id
                    ? 'border-brand bg-brand-soft'
                    : 'border-border bg-card hover:bg-accent'
                )}
              >
                <span
                  className={cn(
                    'block text-xs font-medium',
                    hostMode === opt.id ? 'text-brand' : 'text-foreground'
                  )}
                >
                  {opt.title}
                </span>
                <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">
                  {opt.desc}
                </span>
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="LAN address" htmlFor="lan-ip">
            <Input
              id="lan-ip"
              value={lanIp}
              onChange={(e) => setLanIp(e.target.value)}
              placeholder="192.168.1.10"
              className="font-mono"
            />
          </Field>
          <Field label="Tailscale address" htmlFor="ts-ip">
            <Input
              id="ts-ip"
              value={tailscaleIp}
              onChange={(e) => setTailscaleIp(e.target.value)}
              placeholder="100.x.y.z"
              className="font-mono"
            />
          </Field>
        </div>

        {hostMode === 'custom' && (
          <Field label="Custom host" htmlFor="custom-host">
            <Input
              id="custom-host"
              value={customHostUrl}
              onChange={(e) => setCustomHostUrl(e.target.value)}
              placeholder="homelab.example.com"
              className="font-mono"
            />
          </Field>
        )}

        <Field label="Dashboard title" htmlFor="dash-title">
          <Input id="dash-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field
          label="Telemetry interval"
          htmlFor="refresh-interval"
          hint="How often the server samples the host and pushes an update."
        >
          <Select
            id="refresh-interval"
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="h-9 w-full"
          >
            <option value={2}>2 seconds (ultra-responsive)</option>
            <option value={3}>3 seconds</option>
            <option value={5}>5 seconds (recommended)</option>
            <option value={10}>10 seconds</option>
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
          </Select>
        </Field>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Alerts</p>
          <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">
            Guardian messages you when a problem appears, gets worse, or clears. Fill in either
            channel, both, or neither — each works on its own.
          </p>

          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Telegram
            </p>
            <Field
              label="Bot token"
              htmlFor="tg-token"
              hint="Create a bot by messaging @BotFather on Telegram; it replies with a token like 123456789:AA…"
            >
              <Input
                id="tg-token"
                type="password"
                autoComplete="off"
                placeholder="123456789:AAExampleTokenFromBotFather"
                value={tgToken}
                onChange={(e) => setTgToken(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field
              label="Chat ID"
              htmlFor="tg-chat"
              hint="Your own numeric ID (message @userinfobot to get it), or a group ID, which starts with a minus sign. Send your bot a message first — it cannot open a conversation with you."
            >
              <Input
                id="tg-chat"
                placeholder="123456789"
                value={tgChatId}
                onChange={(e) => setTgChatId(e.target.value)}
                className="font-mono"
              />
            </Field>
          </div>

          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              WhatsApp <span className="font-normal normal-case">(via CallMeBot)</span>
            </p>
            <Field
              label="Phone number"
              htmlFor="wa-phone"
              hint="Include the country code. Spaces and dashes are fine."
            >
              <Input
                id="wa-phone"
                type="tel"
                placeholder="+44 7700 900123"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field
              label="CallMeBot API key"
              htmlFor="wa-key"
              hint="Message “I allow callmebot to send me messages” on WhatsApp to +34 644 95 42 75 and it replies with your key."
            >
              <Input
                id="wa-key"
                type="password"
                autoComplete="off"
                placeholder="123456"
                value={waApiKey}
                onChange={(e) => setWaApiKey(e.target.value)}
                className="font-mono"
              />
            </Field>
            {/* CallMeBot is a free third-party service and rotates its bot
                number when one gets blocked, so the number above can go stale.
                Point at the source of truth rather than pretending otherwise. */}
            <p className="text-2xs leading-snug text-muted-foreground">
              No reply within two minutes? CallMeBot rotates its bot number when one is blocked —
              check the current number at{' '}
              <a
                href="https://www.callmebot.com/blog/free-api-whatsapp-messages/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand underline underline-offset-2"
              >
                callmebot.com
              </a>
              . Free for personal use only.
            </p>
          </div>

          {/* Tuning only matters once something can actually be notified. */}
          {(tgToken.trim() !== '' || waApiKey.trim() !== '') && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <Field
                label="Alert on"
                htmlFor="alert-min-severity"
                hint="Critical-only is quieter but will not tell you a disk is filling until it is nearly full."
              >
                <Select
                  id="alert-min-severity"
                  value={alertMinSeverity}
                  onChange={(e) => setAlertMinSeverity(e.target.value as 'warn' | 'crit')}
                  className="h-9 w-full"
                >
                  <option value="warn">Warnings and critical (recommended)</option>
                  <option value="crit">Critical only</option>
                </Select>
              </Field>

              <Field
                label="Repeat reminder after"
                htmlFor="alert-cooldown"
                hint="How long an unresolved problem stays quiet before it is mentioned again. Escalations always notify immediately."
              >
                <Select
                  id="alert-cooldown"
                  value={alertCooldownMinutes}
                  onChange={(e) => setAlertCooldownMinutes(Number(e.target.value))}
                  className="h-9 w-full"
                >
                  <option value={15}>15 minutes</option>
                  <option value={60}>1 hour (recommended)</option>
                  <option value={240}>4 hours</option>
                  <option value={1440}>24 hours</option>
                </Select>
              </Field>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Backup configuration</p>
            <p className="text-2xs text-muted-foreground">Icons, categories and bookmarks as JSON.</p>
          </div>
          <Button variant="outline" size="xs" onClick={handleExportConfig}>
            <Download className="h-3 w-3" aria-hidden="true" />
            Export
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
