import React, { useState, useEffect, useCallback } from 'react';
import { Power, RotateCcw, AlertTriangle, Loader2, Info, Copy, Check } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PowerAction, PowerCapability } from '../../types/dashboard';
import { cn } from '../../lib/utils';

const ACTION_COPY: Record<PowerAction, { title: string; verb: string; blurb: string }> = {
  shutdown: {
    title: 'Shut down server',
    verb: 'Shut down',
    blurb:
      'The machine will power off. Every container stops, and Guardian will be unreachable until someone turns it back on physically.',
  },
  reboot: {
    title: 'Reboot server',
    verb: 'Reboot',
    blurb:
      'The machine will restart. Containers with a restart policy come back automatically; this dashboard is unavailable until it finishes booting.',
  },
};

export function PowerMenu() {
  const [capability, setCapability] = useState<PowerCapability | null>(null);
  const [action, setAction] = useState<PowerAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadCapability = useCallback(async () => {
    try {
      const res = await fetch('/api/power');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCapability(await res.json());
    } catch {
      setCapability(null);
    }
  }, []);

  useEffect(() => {
    loadCapability();
  }, [loadCapability]);

  const openDialog = (next: PowerAction) => {
    setAction(next);
    setConfirmation('');
    setError(null);
    setIssued(false);
    setCopied(false);
  };

  const copyPhrase = async () => {
    const phrase = capability?.confirmationPhrase ?? '';
    try {
      await navigator.clipboard.writeText(phrase);
    } catch {
      // Clipboard access needs a secure context; the text is selectable either way.
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const submit = async () => {
    if (!action) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/power/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setIssued(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Hidden entirely when the server has not opted in — no dead controls.
  if (!capability?.enabled) return null;

  const phrase = capability.confirmationPhrase;
  const confirmed = confirmation.trim() === phrase;

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
        <button
          type="button"
          onClick={() => openDialog('reboot')}
          title="Reboot server"
          aria-label="Reboot server"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => openDialog('shutdown')}
          title="Shut down server"
          aria-label="Shut down server"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-crit-soft hover:text-crit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Power className="h-4 w-4" />
        </button>
      </div>

      <Dialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
        title={action ? ACTION_COPY[action].title : ''}
        description={capability.description ?? undefined}
        maxWidth="md"
        footer={
          issued ? (
            <Button variant="outline" size="sm" onClick={() => setAction(null)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={submit}
                disabled={!confirmed || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  action && ACTION_COPY[action].verb
                )}
              </Button>
            </>
          )
        }
      >
        {issued ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn-soft/60 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <div className="text-xs">
              <p className="font-medium text-foreground">Command issued.</p>
              <p className="mt-0.5 text-muted-foreground">
                The server is {action === 'reboot' ? 'restarting' : 'powering off'}. This dashboard
                will stop responding shortly.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-crit/25 bg-crit-soft/60 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crit" aria-hidden="true" />
              <p className="text-xs text-foreground">{action && ACTION_COPY[action].blurb}</p>
            </div>

            {capability.inContainer && capability.mechanism !== 'custom' && (
              <div className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn-soft/60 p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <p className="text-xs text-foreground">
                  Guardian is running in a container, so this will act on the container rather than
                  the host. Set <code className="font-mono">GUARDIAN_POWER_COMMAND</code> to reach
                  the host.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="power-confirm" className="text-xs font-medium text-foreground">
                Type this hostname to confirm
              </label>

              {/*
                The hostname sits outside the <label>. Inside one, a click is
                forwarded to the associated input, so dragging to select the
                text just moved the caret into the field instead. `select-all`
                makes a single click grab the whole hostname.
              */}
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5">
                <code className="flex-1 select-all font-mono text-xs text-crit">{phrase}</code>
                <button
                  type="button"
                  onClick={copyPhrase}
                  title="Copy hostname"
                  aria-label="Copy hostname"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-ok" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <Input
                id="power-confirm"
                data-autofocus
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && confirmed && !submitting) submit();
                }}
                placeholder={phrase}
                autoComplete="off"
                spellCheck={false}
                className={cn('font-mono', confirmed && 'border-crit')}
              />
              <p className="text-2xs text-muted-foreground">
                Confirming by hostname is what stops this firing by accident.
              </p>
            </div>

            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-2xs text-crit">
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
