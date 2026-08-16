import fs from 'node:fs';
import path from 'node:path';
import { MetricKey, MetricSample, HistoryRange, HistorySeries } from './types.js';
import { logger } from './logger.js';

/*
 * Tiered telemetry history.
 *
 * Keeping a month of raw samples would mean ~172,800 points per metric at a 15s
 * cadence -- far too much to hold in memory, serialise to JSON, or draw. Instead
 * this keeps three resolutions and rolls older data down into coarser buckets,
 * the way RRD-style databases do:
 *
 *   fine    every sample      6 hours    ~1.4k points
 *   medium  5-minute means    7 days     ~2k points
 *   coarse  1-hour means      30 days    ~720 points
 *
 * Total is a few thousand points, so the whole month fits comfortably in memory
 * and in a single JSON file, and every query returns a series small enough to
 * render without downsampling on the client.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const METRIC_KEYS: MetricKey[] = [
  'cpu',
  'ram',
  'swap',
  'temp',
  'netRx',
  'netTx',
  'disk',
];

interface TierConfig {
  name: 'fine' | 'medium' | 'coarse';
  bucketMs: number;
  retentionMs: number;
}

const TIERS: TierConfig[] = [
  { name: 'fine', bucketMs: 0, retentionMs: 6 * HOUR },
  { name: 'medium', bucketMs: 5 * MINUTE, retentionMs: 7 * DAY },
  { name: 'coarse', bucketMs: HOUR, retentionMs: 30 * DAY },
];

/** Accumulates a bucket's running mean without retaining its samples. */
interface Accumulator {
  bucketStart: number;
  sums: Partial<Record<MetricKey, number>>;
  counts: Partial<Record<MetricKey, number>>;
}

interface TierState {
  config: TierConfig;
  samples: MetricSample[];
  acc: Accumulator | null;
}

interface PersistedShape {
  version: 1;
  tiers: Record<string, MetricSample[]>;
}

const RANGE_MS: Record<HistoryRange, number> = {
  '1h': HOUR,
  '6h': 6 * HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

export class TelemetryHistory {
  private tiers: TierState[];
  private filePath: string | null;
  private dirty = false;
  private lastSaveAt = 0;
  private saveIntervalMs = 60_000;
  /** Newest sample timestamp seen, used as the retention anchor. */
  private newestSeen = 0;

  constructor(filePath: string | null) {
    this.filePath = filePath;
    this.tiers = TIERS.map((config) => ({ config, samples: [], acc: null }));
    this.load();
  }

  /** Records one observation across every metric present. */
  push(timestamp: number, values: Partial<Record<MetricKey, number>>): void {
    const clean: Partial<Record<MetricKey, number>> = {};
    for (const key of METRIC_KEYS) {
      const v = values[key];
      if (typeof v === 'number' && Number.isFinite(v)) clean[key] = v;
    }
    if (Object.keys(clean).length === 0) return;

    for (const tier of this.tiers) {
      if (tier.config.bucketMs === 0) {
        const last = tier.samples[tier.samples.length - 1];
        if (last && timestamp < last.t) {
          // Out-of-order arrival (a clock step, or a backfill interleaved with
          // live samples). Insert in place rather than appending, because both
          // pruning and charting assume the series is sorted by time.
          const at = tier.samples.findIndex((s) => s.t > timestamp);
          tier.samples.splice(at === -1 ? tier.samples.length : at, 0, { t: timestamp, v: clean });
        } else {
          tier.samples.push({ t: timestamp, v: clean });
        }
      } else {
        this.accumulate(tier, timestamp, clean);
      }
    }

    // Prune against the newest timestamp seen, so a single stale sample cannot
    // drag the retention window backwards and resurrect expired data.
    this.newestSeen = Math.max(this.newestSeen, timestamp);
    this.prune(this.newestSeen);
    this.dirty = true;
    this.maybeSave();
  }

  private accumulate(
    tier: TierState,
    timestamp: number,
    values: Partial<Record<MetricKey, number>>
  ): void {
    const bucketStart = Math.floor(timestamp / tier.config.bucketMs) * tier.config.bucketMs;

    if (tier.acc && tier.acc.bucketStart !== bucketStart) {
      this.flush(tier);
    }
    if (!tier.acc) {
      tier.acc = { bucketStart, sums: {}, counts: {} };
    }

    for (const [key, value] of Object.entries(values) as Array<[MetricKey, number]>) {
      tier.acc.sums[key] = (tier.acc.sums[key] ?? 0) + value;
      tier.acc.counts[key] = (tier.acc.counts[key] ?? 0) + 1;
    }
  }

  /** Closes the open bucket and appends its mean. */
  private flush(tier: TierState): void {
    if (!tier.acc) return;
    const v: Partial<Record<MetricKey, number>> = {};
    for (const [key, sum] of Object.entries(tier.acc.sums) as Array<[MetricKey, number]>) {
      const count = tier.acc.counts[key] ?? 1;
      v[key] = Math.round((sum / count) * 100) / 100;
    }
    tier.samples.push({ t: tier.acc.bucketStart, v });
    tier.acc = null;
  }

  private prune(now: number): void {
    for (const tier of this.tiers) {
      const cutoff = now - tier.config.retentionMs;
      // Samples are appended in order, so dropping the leading run is enough.
      let firstKept = 0;
      while (firstKept < tier.samples.length && tier.samples[firstKept].t < cutoff) {
        firstKept += 1;
      }
      if (firstKept > 0) tier.samples.splice(0, firstKept);
    }
  }

  /** Picks the finest tier whose retention actually covers the request. */
  private tierFor(range: HistoryRange): TierState {
    const windowMs = RANGE_MS[range];
    for (const tier of this.tiers) {
      if (windowMs <= tier.config.retentionMs) return tier;
    }
    return this.tiers[this.tiers.length - 1];
  }

  getSeries(metric: MetricKey, range: HistoryRange): HistorySeries {
    const tier = this.tierFor(range);
    const since = Date.now() - RANGE_MS[range];

    // Include the open bucket so the newest reading is never missing from a
    // coarse view -- otherwise a 30d chart lags by up to an hour.
    const pending: MetricSample[] = [];
    if (tier.acc) {
      const sum = tier.acc.sums[metric];
      const count = tier.acc.counts[metric];
      if (sum !== undefined && count) {
        pending.push({ t: tier.acc.bucketStart, v: { [metric]: sum / count } });
      }
    }

    const points = [...tier.samples, ...pending]
      .filter((s) => s.t >= since && s.v[metric] !== undefined)
      .map((s) => ({ t: s.t, v: s.v[metric] as number }));

    const values = points.map((p) => p.v);

    return {
      metric,
      range,
      resolution: tier.config.name,
      bucketMs: tier.config.bucketMs || 0,
      points,
      stats: values.length
        ? {
            min: Math.round(Math.min(...values) * 100) / 100,
            max: Math.round(Math.max(...values) * 100) / 100,
            avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
            latest: values[values.length - 1],
            count: values.length,
          }
        : null,
    };
  }

  /** Recent fine-grained points, for the dashboard sparklines. */
  getRecent(limit: number = 120): MetricSample[] {
    const fine = this.tiers[0].samples;
    return fine.slice(-limit);
  }

  getCoverage(): { oldest: number | null; newest: number | null; totalPoints: number } {
    let oldest: number | null = null;
    let newest: number | null = null;
    let total = 0;
    for (const tier of this.tiers) {
      total += tier.samples.length;
      if (tier.samples.length > 0) {
        const first = tier.samples[0].t;
        const last = tier.samples[tier.samples.length - 1].t;
        oldest = oldest === null ? first : Math.min(oldest, first);
        newest = newest === null ? last : Math.max(newest, last);
      }
    }
    return { oldest, newest, totalPoints: total };
  }

  /* ------------------------------ persistence ------------------------------ */

  private load(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as PersistedShape;
      if (parsed?.version !== 1 || !parsed.tiers) return;

      for (const tier of this.tiers) {
        const stored = parsed.tiers[tier.config.name];
        if (Array.isArray(stored)) {
          tier.samples = stored.filter(
            (s) => s && typeof s.t === 'number' && s.v && typeof s.v === 'object'
          );
        }
      }
      this.newestSeen = Math.max(
        0,
        ...this.tiers.flatMap((t) => (t.samples.length ? [t.samples[t.samples.length - 1].t] : [0]))
      );
      this.prune(Date.now());
    } catch (err) {
      // A corrupt history file must never stop the server from booting; the
      // worst case is losing past samples.
      logger.warn('history', 'Could not read history file', err);
    }
  }

  /*
   * Throttled by wall clock, deliberately.
   *
   * This used to be handed the *sample* timestamp and compare it against a
   * wall-clock `lastSaveAt`. Mixing the two clocks meant that backfilling
   * historical samples (whose timestamps are in the past) made the difference
   * negative forever after the first write, and during a bulk import it wrote
   * the entire file on nearly every push -- turning a few thousand inserts into
   * minutes of synchronous disk I/O.
   */
  private maybeSave(): void {
    const nowWall = Date.now();
    if (nowWall - this.lastSaveAt < this.saveIntervalMs) return;
    this.save();
  }

  save(): void {
    if (!this.filePath || !this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const payload: PersistedShape = {
        version: 1,
        tiers: Object.fromEntries(this.tiers.map((t) => [t.config.name, t.samples])),
      };

      // Temp file + rename, so a crash mid-write cannot truncate the history.
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmp, this.filePath);

      this.dirty = false;
      this.lastSaveAt = Date.now();
    } catch (err) {
      logger.error('history', 'Failed to persist history', err);
    }
  }

  /** Closes open buckets and writes to disk. Called on shutdown. */
  flushAndSave(): void {
    for (const tier of this.tiers) {
      if (tier.config.bucketMs > 0) this.flush(tier);
    }
    this.dirty = true;
    this.save();
  }
}

const DATA_DIR = process.env.DATA_DIR || '/data';

function resolveHistoryPath(): string {
  if (fs.existsSync(DATA_DIR)) return path.join(DATA_DIR, 'history.json');
  return path.join(process.cwd(), 'data', 'history.json');
}

export const telemetryHistory = new TelemetryHistory(resolveHistoryPath());
