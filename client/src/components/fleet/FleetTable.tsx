import React, { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  Loader2,
  RotateCcw,
  ScrollText,
  Settings2,
  Trash2,
} from 'lucide-react';
import { ContainerItem, CustomAppBookmark, DashboardSettings } from '../../types/dashboard';
import { isQuietlyStopped } from '../../lib/glance';
import {
  cn,
  containerIssues,
  containerSeverity,
  formatBytes,
  formatRate,
  resolveBookmarkUrl,
  resolveContainerUrl,
  Severity,
} from '../../lib/utils';
import { Readout, splitUnit } from '../ui/Readout';

export type FleetSortKey = 'default' | 'name' | 'cpu' | 'mem' | 'net';

export interface FleetEntry {
  item: ContainerItem | CustomAppBookmark;
  isCustomBookmark: boolean;
}

interface FleetTableProps {
  entries: FleetEntry[];
  settings?: DashboardSettings;
  sortBy: FleetSortKey;
  onSort: (key: FleetSortKey) => void;
  /** Open stopped/bookmark groups regardless of the collapsed default (e.g. while searching). */
  forceExpand?: boolean;
  onEdit: (item: ContainerItem | CustomAppBookmark, isCustomBookmark: boolean) => void;
  onDeleteBookmark?: (id: string) => void;
  onViewLogs?: (container: ContainerItem) => void;
  onRestartContainer?: (container: ContainerItem) => Promise<boolean | void>;
  onUpdateContainer?: (container: ContainerItem) => Promise<boolean | void>;
}

/** Below this a flow of bytes is idle chatter, not activity worth a colour. */
const ACTIVE_IO_BYTES = 1024;

/* --------------------------------- state --------------------------------- */

interface StateView {
  label: string;
  tone: Severity | 'idle';
}

/**
 * One chip per container, chosen so it never contradicts the issues list: a
 * failing healthcheck outranks "running", a non-zero exit outranks "stopped".
 */
function stateView(c: ContainerItem): StateView {
  if (c.state === 'restarting') return { label: 'restarting', tone: 'crit' };
  if (c.state === 'dead') return { label: 'dead', tone: 'crit' };
  if (c.oomKilled) return { label: 'oom killed', tone: 'crit' };
  if (c.state === 'paused') return { label: 'paused', tone: 'warn' };
  if (c.state === 'exited') {
    return (c.exitCode ?? 0) !== 0
      ? { label: `exit ${c.exitCode}`, tone: 'warn' }
      : { label: 'stopped', tone: 'idle' };
  }
  if (c.state === 'created') return { label: 'created', tone: 'idle' };
  // running
  if (c.health === 'unhealthy') return { label: 'unhealthy', tone: 'crit' };
  if (c.health === 'starting') return { label: 'starting', tone: 'warn' };
  if (c.health === 'healthy') return { label: 'healthy', tone: 'ok' };
  return { label: 'running', tone: 'ok' };
}

const TONE_CHIP: Record<StateView['tone'], string> = {
  ok: 'border-ok/25 bg-ok-soft text-ok',
  warn: 'border-warn/30 bg-warn-soft text-warn',
  crit: 'border-crit/35 bg-crit-soft text-crit',
  idle: 'border-border text-muted-foreground',
};

const TONE_DOT: Record<StateView['tone'], string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  idle: 'bg-muted-foreground/60',
};

function StateChip({ view, title }: { view: StateView; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-2xs leading-4',
        TONE_CHIP[view.tone]
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[view.tone])} aria-hidden="true" />
      {view.label}
    </span>
  );
}

/* ---------------------------------- cells --------------------------------- */

function RowIcon({ item, name }: { item: ContainerItem | CustomAppBookmark; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted p-0.5">
      {item.iconUrl && !broken ? (
        <img src={item.iconUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-contain" />
      ) : (
        <span className="text-3xs font-semibold uppercase text-muted-foreground">{name.slice(0, 2)}</span>
      )}
    </span>
  );
}

const iconBtn =
  'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function MetricCell({ value, unit, tone }: { value: string; unit?: string; tone?: 'warn' | 'crit' | 'io' }) {
  return (
    <Readout
      value={value}
      unit={unit}
      className={cn('text-xs', tone === 'warn' && 'text-warn', tone === 'crit' && 'text-crit', tone === 'io' && 'text-io')}
    />
  );
}

const Dash = () => <span className="font-mono text-xs text-muted-foreground/50">—</span>;

/* ---------------------------- container row ---------------------------- */

interface ContainerRowProps extends Pick<FleetTableProps, 'settings' | 'onEdit' | 'onViewLogs' | 'onRestartContainer' | 'onUpdateContainer'> {
  container: ContainerItem;
  muted?: boolean;
}

function ContainerRow({
  container,
  settings,
  muted,
  onEdit,
  onViewLogs,
  onRestartContainer,
  onUpdateContainer,
}: ContainerRowProps) {
  const [busy, setBusy] = useState<'restart' | 'update' | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const name = container.displayName || container.name;
  const url = resolveContainerUrl(container, settings);
  const hasUrl = Boolean(url && url !== '#' && !url.endsWith('/#'));
  const issues = containerIssues(container);
  const severity = containerSeverity(container);
  const view = stateView(container);
  const running = container.state === 'running';

  const ports = container.ports
    ?.map((p) => p.publicPort || p.privatePort)
    .filter((p, i, a) => a.indexOf(p) === i)
    .slice(0, 3)
    .join(', ');

  const run = async (kind: 'restart' | 'update', fn?: (c: ContainerItem) => Promise<boolean | void>) => {
    if (!fn) return;
    setBusy(kind);
    setFeedback(null);
    try {
      await fn(container);
      setFeedback({ tone: 'ok', message: kind === 'restart' ? 'Restarted' : 'Updated & restarted' });
      window.setTimeout(() => setFeedback(null), 3500);
    } catch (err) {
      setFeedback({ tone: 'error', message: (err as Error).message || `${kind === 'restart' ? 'Restart' : 'Update'} failed` });
      window.setTimeout(() => setFeedback(null), 7000);
    } finally {
      setBusy(null);
    }
  };

  const rx = container.networkRxBytesPerSec ?? 0;
  const tx = container.networkTxBytesPerSec ?? 0;
  const netActive = rx > ACTIVE_IO_BYTES || tx > ACTIVE_IO_BYTES;

  const cpu = container.cpuPercent;
  const cpuTone = container.cpuThrottlingNow || (container.cpuPercentOfLimit ?? 0) >= 90 ? 'warn' : undefined;

  const memShare =
    container.memoryLimitIsExplicit && container.memoryLimitBytes && container.memoryBytes
      ? (container.memoryBytes / container.memoryLimitBytes) * 100
      : 0;
  const mem = container.memoryBytes !== undefined ? splitUnit(formatBytes(container.memoryBytes, 0)) : null;

  return (
    <tr
      className={cn(
        'group border-t border-border/70 transition-colors hover:bg-accent/40 focus-within:bg-accent/40',
        muted && 'opacity-70 hover:opacity-100',
        severity === 'crit' && 'bg-crit-soft/20'
      )}
    >
      <td className="max-w-0 py-2 pl-3 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <RowIcon item={container} name={name} />
          <div className="min-w-0">
            {hasUrl && url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={`Open ${url}`}
              >
                {name}
              </a>
            ) : (
              <span className="block truncate text-xs font-medium text-foreground">{name}</span>
            )}
            <p className="truncate font-mono text-3xs text-muted-foreground">
              {feedback ? (
                <span className={feedback.tone === 'ok' ? 'text-ok' : 'text-crit'} role="status">
                  {feedback.message}
                </span>
              ) : issues.length > 0 ? (
                <span
                  className={severity === 'crit' ? 'text-crit' : 'text-warn'}
                  title={issues.map((i) => i.detail).join('\n\n')}
                >
                  {issues.map((i) => i.label).join(' · ')}
                </span>
              ) : (
                <>
                  {container.category || 'General'}
                  {ports ? <> · :{ports}</> : container.networkParent ? <> · via {container.networkParent}</> : null}
                </>
              )}
            </p>
          </div>
        </div>
      </td>

      <td className="px-2 py-2">
        <StateChip view={view} title={container.status} />
      </td>

      <td className="px-2 py-2 text-right">
        {running && cpu !== undefined ? (
          <MetricCell
            value={cpu.toFixed(1)}
            unit="%"
            tone={cpuTone}
          />
        ) : (
          <Dash />
        )}
      </td>

      <td className="hidden px-2 py-2 text-right md:table-cell">
        {running && mem ? (
          <MetricCell value={mem.value} unit={mem.unit} tone={memShare >= 90 ? 'warn' : undefined} />
        ) : (
          <Dash />
        )}
      </td>

      <td className="hidden px-2 py-2 text-right lg:table-cell">
        {running && (rx > 0 || tx > 0) ? (
          <span className={cn('inline-flex items-baseline gap-2 font-mono text-2xs tabular-nums', netActive ? 'text-io' : 'text-muted-foreground')}>
            <span title={`Receive ${formatRate(rx)}`}>↓ {formatRate(rx)}</span>
            <span title={`Transmit ${formatRate(tx)}`}>↑ {formatRate(tx)}</span>
          </span>
        ) : (
          <Dash />
        )}
      </td>

      <td className="py-2 pl-2 pr-3">
        <div className="flex items-center justify-end gap-0.5 opacity-50 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {hasUrl && url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={iconBtn}
              aria-label={`Open ${name}`}
              title="Open"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
          {onViewLogs && (
            <button type="button" className={iconBtn} onClick={() => onViewLogs(container)} aria-label={`View logs for ${name}`} title="Logs">
              <ScrollText className="h-3.5 w-3.5" />
            </button>
          )}
          {onRestartContainer && (
            <button
              type="button"
              className={iconBtn}
              disabled={busy !== null}
              onClick={() => run('restart', onRestartContainer)}
              aria-label={`Restart ${name}`}
              title={busy === 'restart' ? 'Restarting…' : 'Restart'}
            >
              <RotateCcw className={cn('h-3.5 w-3.5', busy === 'restart' && 'animate-spin text-warn')} />
            </button>
          )}
          {onUpdateContainer && (
            <button
              type="button"
              className={iconBtn}
              disabled={busy !== null}
              onClick={() => run('update', onUpdateContainer)}
              aria-label={`Update image and restart ${name}`}
              title={busy === 'update' ? 'Pulling latest image & recreating…' : 'Update image & recreate'}
            >
              {busy === 'update' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5" />}
            </button>
          )}
          <button type="button" className={iconBtn} onClick={() => onEdit(container, false)} aria-label={`Configure ${name}`} title="Configure">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- bookmark row ----------------------------- */

function BookmarkRow({
  bookmark,
  settings,
  onEdit,
  onDeleteBookmark,
}: {
  bookmark: CustomAppBookmark;
  settings?: DashboardSettings;
  onEdit: FleetTableProps['onEdit'];
  onDeleteBookmark?: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const url = resolveBookmarkUrl(bookmark, settings);

  return (
    <tr className="group border-t border-border/70 transition-colors hover:bg-accent/40 focus-within:bg-accent/40">
      <td className="max-w-0 py-2 pl-3 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <RowIcon item={bookmark} name={bookmark.name} />
          <div className="min-w-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs font-medium text-foreground hover:underline"
              title={`Open ${url}`}
            >
              {bookmark.name}
            </a>
            <p className="truncate font-mono text-3xs text-muted-foreground">{bookmark.description || bookmark.category || 'Bookmark'}</p>
          </div>
        </div>
      </td>
      <td className="px-2 py-2">
        <StateChip view={{ label: 'bookmark', tone: 'idle' }} />
      </td>
      <td className="px-2 py-2 text-right"><Dash /></td>
      <td className="hidden px-2 py-2 text-right md:table-cell"><Dash /></td>
      <td className="hidden px-2 py-2 text-right lg:table-cell"><Dash /></td>
      <td className="py-2 pl-2 pr-3">
        <div className="flex items-center justify-end gap-0.5 opacity-50 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <a href={url} target="_blank" rel="noopener noreferrer" className={iconBtn} aria-label={`Open ${bookmark.name}`} title="Open">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <button type="button" className={iconBtn} onClick={() => onEdit(bookmark, true)} aria-label={`Configure ${bookmark.name}`} title="Configure">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          {onDeleteBookmark && (
            <button
              type="button"
              className={cn(iconBtn, confirm && 'bg-crit-soft text-crit hover:bg-crit-soft hover:text-crit')}
              onClick={() => {
                if (confirm) onDeleteBookmark(bookmark.id);
                else {
                  setConfirm(true);
                  window.setTimeout(() => setConfirm(false), 3000);
                }
              }}
              aria-label={confirm ? `Confirm delete ${bookmark.name}` : `Delete ${bookmark.name}`}
              title={confirm ? 'Click again to confirm' : 'Delete bookmark'}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- collapsed group ----------------------------- */

function GroupToggle({
  open,
  onToggle,
  collapsedLabel,
  expandedLabel,
}: {
  open: boolean;
  onToggle: () => void;
  collapsedLabel: string;
  expandedLabel: string;
}) {
  return (
    <tr className="border-t border-border/70">
      <td colSpan={6} className="p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-2xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          {open ? expandedLabel : collapsedLabel}
        </button>
      </td>
    </tr>
  );
}

/* --------------------------------- table --------------------------------- */

function SortTh({
  label,
  k,
  sortBy,
  onSort,
  className,
  align = 'right',
}: {
  label: string;
  k: FleetSortKey;
  sortBy: FleetSortKey;
  onSort: (k: FleetSortKey) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = sortBy === k;
  return (
    <th
      scope="col"
      aria-sort={active ? 'descending' : 'none'}
      className={cn('px-2 py-2 font-normal', align === 'right' ? 'text-right' : 'text-left', className)}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        title="Sort within severity. Containers with issues always come first."
        className={cn(
          'font-mono text-3xs uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {label}
        {active && k !== 'name' ? ' ↓' : ''}
      </button>
    </th>
  );
}

export function FleetTable({
  entries,
  settings,
  sortBy,
  onSort,
  forceExpand = false,
  onEdit,
  onDeleteBookmark,
  onViewLogs,
  onRestartContainer,
  onUpdateContainer,
}: FleetTableProps) {
  const [stoppedOpen, setStoppedOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  const containers = entries.filter((e) => !e.isCustomBookmark).map((e) => e.item as ContainerItem);
  const bookmarks = entries.filter((e) => e.isCustomBookmark).map((e) => e.item as CustomAppBookmark);

  const active = containers.filter((c) => !isQuietlyStopped(c));
  const stopped = containers.filter(isQuietlyStopped);

  const showStopped = forceExpand || stoppedOpen;
  const showBookmarks = forceExpand || bookmarksOpen;

  const rowProps = { settings, onEdit, onViewLogs, onRestartContainer, onUpdateContainer };

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col />
            <col className="w-[7.5rem]" />
            <col className="w-[4.5rem]" />
            <col className="hidden w-[5rem] md:table-column" />
            <col className="hidden w-[11rem] lg:table-column" />
            <col className="w-[9.5rem]" />
          </colgroup>
          <thead>
            <tr>
              <SortTh label="Name" k="name" sortBy={sortBy} onSort={onSort} align="left" className="pl-3" />
              <th scope="col" className="px-2 py-2 text-left font-mono text-3xs font-normal uppercase tracking-wider text-muted-foreground">
                State
              </th>
              <SortTh label="CPU" k="cpu" sortBy={sortBy} onSort={onSort} />
              <SortTh label="Mem" k="mem" sortBy={sortBy} onSort={onSort} className="hidden md:table-cell" />
              <SortTh label="Net I/O" k="net" sortBy={sortBy} onSort={onSort} className="hidden lg:table-cell" />
              <th scope="col" className="py-2 pl-2 pr-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {active.map((c) => (
              <ContainerRow key={c.id} container={c} {...rowProps} />
            ))}

            {stopped.length > 0 && (
              <>
                {!forceExpand && (
                  <GroupToggle
                    open={showStopped}
                    onToggle={() => setStoppedOpen((v) => !v)}
                    collapsedLabel={`${stopped.length} stopped container${stopped.length === 1 ? '' : 's'} collapsed · click to view`}
                    expandedLabel={`Hide ${stopped.length} stopped container${stopped.length === 1 ? '' : 's'}`}
                  />
                )}
                {showStopped && stopped.map((c) => <ContainerRow key={c.id} container={c} muted {...rowProps} />)}
              </>
            )}

            {bookmarks.length > 0 && (
              <>
                {!forceExpand && (
                  <GroupToggle
                    open={showBookmarks}
                    onToggle={() => setBookmarksOpen((v) => !v)}
                    collapsedLabel={`${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'} collapsed · click to view`}
                    expandedLabel={`Hide ${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'}`}
                  />
                )}
                {showBookmarks &&
                  bookmarks.map((b) => (
                    <BookmarkRow key={b.id} bookmark={b} settings={settings} onEdit={onEdit} onDeleteBookmark={onDeleteBookmark} />
                  ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
