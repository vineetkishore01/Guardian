import fs from 'node:fs';
import path from 'node:path';
import { LogEntry, LogLevel } from './types.js';

/*
 * Application log buffer.
 *
 * Guardian normally runs as a background container, so when something goes
 * wrong there is nowhere to look without `docker logs`. This keeps a bounded
 * ring of structured entries in memory, mirrors them to stdout (so `docker
 * logs` still works), and persists the tail to disk so the record survives a
 * crash and restart -- which is exactly the case you most want it for.
 */

const MAX_ENTRIES = 1000;
const PERSIST_ENTRIES = 300;
const SAVE_DEBOUNCE_MS = 5000;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'log' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'log',
  warn: 'warn',
  error: 'error',
};

class Logger {
  private entries: LogEntry[] = [];
  private seq = 0;
  private filePath: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

  attachFile(filePath: string): void {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter((e) => e && typeof e.t === 'number' && e.level);
        this.seq = this.entries.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
        // Mark the boundary so a reader can see where the previous run ended.
        this.write('info', 'system', 'Guardian started', {
          restoredEntries: this.entries.length,
        });
      }
    } catch {
      this.entries = [];
    }
  }

  private scheduleSave(): void {
    if (!this.filePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  save(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tail = this.entries.slice(-PERSIST_ENTRIES);
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(tail), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch {
      // Never let logging failures escalate into request failures.
    }
  }

  private write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;

    this.seq += 1;
    const entry: LogEntry = {
      id: this.seq,
      t: Date.now(),
      level,
      scope,
      message,
      detail: detail === undefined ? undefined : safeDetail(detail),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }

    // Mirror to stdout so `docker logs guardian` stays useful.
    const line = `[${scope}] ${message}`;
    if (entry.detail !== undefined) {
      console[CONSOLE_METHOD[level]](line, entry.detail);
    } else {
      console[CONSOLE_METHOD[level]](line);
    }

    if (level === 'warn' || level === 'error') this.scheduleSave();
  }

  debug(scope: string, message: string, detail?: unknown): void {
    this.write('debug', scope, message, detail);
  }
  info(scope: string, message: string, detail?: unknown): void {
    this.write('info', scope, message, detail);
  }
  warn(scope: string, message: string, detail?: unknown): void {
    this.write('warn', scope, message, detail);
  }
  error(scope: string, message: string, detail?: unknown): void {
    this.write('error', scope, message, detail);
  }

  query(options: { level?: LogLevel; scope?: string; limit?: number; since?: number } = {}): {
    entries: LogEntry[];
    total: number;
    counts: Record<LogLevel, number>;
  } {
    const minRank = options.level ? LEVEL_RANK[options.level] : 0;
    const limit = Math.min(Math.max(options.limit ?? 200, 1), MAX_ENTRIES);

    const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const e of this.entries) counts[e.level] += 1;

    const filtered = this.entries.filter((e) => {
      if (LEVEL_RANK[e.level] < minRank) return false;
      if (options.scope && e.scope !== options.scope) return false;
      if (options.since && e.t < options.since) return false;
      return true;
    });

    return {
      // Newest first -- that is what you want when something just broke.
      entries: filtered.slice(-limit).reverse(),
      total: filtered.length,
      counts,
    };
  }

  scopes(): string[] {
    return [...new Set(this.entries.map((e) => e.scope))].sort();
  }

  clear(): void {
    this.entries = [];
    this.write('info', 'system', 'Log buffer cleared');
    this.save();
  }
}

/** Keeps detail JSON-serialisable and bounded. */
function safeDetail(detail: unknown): unknown {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack?.slice(0, 2000) };
  }
  try {
    const json = JSON.stringify(detail);
    if (json === undefined) return String(detail);
    return json.length > 4000 ? `${json.slice(0, 4000)}…` : JSON.parse(json);
  } catch {
    return String(detail);
  }
}

export const logger = new Logger();

/** Routes crashes into the same buffer the UI reads. */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    logger.error('process', 'Uncaught exception', err);
    logger.save();
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('process', 'Unhandled promise rejection', reason);
    logger.save();
  });
  process.on('warning', (warning) => {
    logger.warn('process', warning.message, { name: warning.name });
  });
}
