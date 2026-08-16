import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Rendered in the footer bar, pinned below the scrolling body. */
  footer?: React.ReactNode;
}

const MAX_WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

/*
 * Scroll locking is reference counted. The previous implementation reset
 * `body.overflow` to 'unset' in its cleanup, so opening a second dialog over a
 * first (edit-app over the grid, say) and closing it unlocked the page while a
 * dialog was still on screen.
 */
let lockCount = 0;

function lockScroll() {
  if (lockCount === 0) document.body.style.overflow = 'hidden';
  lockCount += 1;
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = '';
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = 'lg',
  footer,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  /*
   * The setup effect must depend on `open` alone.
   *
   * It previously also listed `onOpenChange`, which callers almost always pass
   * as an inline arrow — a new function identity on every render. Typing one
   * character re-rendered the parent, changed that identity, and tore the
   * effect down and back up: the cleanup called `restoreFocusRef.current
   * .focus()`, yanking focus out of the field mid-word. Holding the callback in
   * a ref keeps the handler current without making it a dependency.
   */
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    lockScroll();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChangeRef.current(false);
        return;
      }

      // Minimal focus trap: keep Tab inside the panel while it is open.
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    /*
     * Move focus into the panel, preferring the first real field.
     *
     * The previous selector listed `button` alongside the fields, and
     * querySelector returns the first match in *document* order — which is the
     * close button in the header, not the input in the body. Opening a dialog
     * therefore parked the caret on "Close" every time.
     */
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const field = panel.querySelector<HTMLElement>(
        '[data-autofocus], input:not([type="checkbox"]):not([type="radio"]), textarea, select'
      );
      const fallback = panel.querySelector<HTMLElement>(
        'button:not([data-dialog-close])'
      );
      (field ?? fallback ?? panel).focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKeyDown);
      unlockScroll();
      restoreFocusRef.current?.focus?.();
    };
    // `open` only — see the note on onOpenChangeRef above.
  }, [open]);

  if (!open) return null;

  /*
   * Rendered through a portal, not in place.
   *
   * `position: fixed` resolves against the nearest ancestor with a transform,
   * filter or backdrop-filter rather than the viewport. PowerMenu lives inside
   * the sticky header, which uses `backdrop-blur-xl` — so this panel was being
   * positioned against a 56px-tall header and rendered clipped off the top of
   * the screen. Portalling to <body> makes placement independent of wherever a
   * dialog happens to be mounted.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 animate-fade-in bg-background/70 backdrop-blur-sm"
        onClick={() => onOpenChangeRef.current(false)}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col animate-scale-in',
          'rounded-t-xl border border-border bg-card text-card-foreground shadow-2xl sm:rounded-xl',
          MAX_WIDTHS[maxWidth]
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            data-dialog-close
            aria-label="Close dialog"
            className="-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
