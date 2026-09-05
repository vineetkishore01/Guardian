import fs from 'node:fs';
import path from 'node:path';
import { DiskMount, DiskTrend } from './types.js';
import { logger } from './logger.js';

/*
 * Per-filesystem fill trend.
 *
 * The dashboard could already tell you a volume was 86% full. It could not tell
 * you whether that was 86% and stable for a month or 86% on the way up from 60%
 * this morning -- and those call for very different reactions. The disk crisis
 * this was written after was not a missing gauge, it was a missing trajectory.
 *
 * This deliberately does not reuse `telemetryHistory`. That store is keyed by a
 * fixed `MetricKey` union and only ever recorded the single fullest volume, so
 * per-mount projection would have meant widening a type that half the client
 * depends on. A purpose-built store is a few dozen lines and cannot destabilise
 * the charts.
 *
 * Resolution is deliberately coarse: one bucket per hour, thirty days, which is
 * 720 points per mount. Fill rates are a slow signal and averaging over an hour
 * suppresses the noise from a torrent finishing or a prune running.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RETENTION_MS = 30 * DAY;

/** Below this many samples a regression is fitting noise, not a trend. */
const MIN_POINTS = 5;
/** And below this span the extrapolation is far too eager. */
const MIN_SPAN_MS = 6 * HOUR;

interface MountPoint {
  /** Bucket start. */
  t: number;
  usedBytes: number;
  totalBytes: number;
}

interface PersistedShape {
  version: 1;
  mounts: Record<string, MountPoint[]>;
}

interface OpenBucket {
  start: number;
  usedSum: number;
  totalSum: number;
  count: number;
}

export class DiskTrendStore {
  private series = new Map<string, MountPoint[]>();
  private open = new Map<string, OpenBucket>();
  private filePath: string | null;
  private dirty = false;
  private lastSaveAt = 0;

  constructor(filePath: string | null) {
    this.filePath = filePath;
    this.load();
  }

  record(disks: DiskMount[], now: number = Date.now()): void {
    for (const disk of disks) {
      if (!disk.mountPoint || disk.totalBytes <= 0) continue;

      const bucketStart = Math.floor(now / HOUR) * HOUR;
      const open = this.open.get(disk.mountPoint);

      if (open && open.start !== bucketStart) {
        this.closeBucket(disk.mountPoint, open);
        this.open.delete(disk.mountPoint);
      }

      const current = this.open.get(disk.mountPoint) ?? {
        start: bucketStart,
        usedSum: 0,
        totalSum: 0,
        count: 0,
      };
      current.usedSum += disk.usedBytes;
      current.totalSum += disk.totalBytes;
      current.count += 1;
      this.open.set(disk.mountPoint, current);
    }

    this.prune(now);
    this.dirty = true;
    this.maybeSave();
  }

  private closeBucket(mountPoint: string, bucket: OpenBucket): void {
    if (bucket.count === 0) return;
    const points = this.series.get(mountPoint) ?? [];
    points.push({
      t: bucket.start,
      usedBytes: Math.round(bucket.usedSum / bucket.count),
      totalBytes: Math.round(bucket.totalSum / bucket.count),
    });
    this.series.set(mountPoint, points);
  }

  private prune(now: number): void {
    const cutoff = now - RETENTION_MS;
    for (const [mountPoint, points] of this.series) {
      let firstKept = 0;
      while (firstKept < points.length && points[firstKept].t < cutoff) firstKept += 1;
      if (firstKept > 0) points.splice(0, firstKept);
      if (points.length === 0) this.series.delete(mountPoint);
    }
  }

  /**
   * Least-squares fit of used bytes against time.
   *
   * Returns undefined rather than a guess when there is not enough history to
   * say anything honest -- a projection from two points an hour apart is worse
   * than no projection, because it looks equally authoritative.
   */
  trendFor(disk: DiskMount, now: number = Date.now()): DiskTrend | undefined {
    const stored = this.series.get(disk.mountPoint) ?? [];

    // Fold the open bucket in, so a fresh restart is not blind to the last hour.
    const open = this.open.get(disk.mountPoint);
    const points: MountPoint[] =
      open && open.count > 0
        ? [
            ...stored,
            {
              t: open.start,
              usedBytes: Math.round(open.usedSum / open.count),
              totalBytes: Math.round(open.totalSum / open.count),
            },
          ]
        : stored;

    if (points.length < MIN_POINTS) return undefined;

    const spanMs = points[points.length - 1].t - points[0].t;
    if (spanMs < MIN_SPAN_MS) return undefined;

    // Regress in days to keep the numbers in a sane range for floating point.
    const t0 = points[0].t;
    const xs = points.map((p) => (p.t - t0) / DAY);
    const ys = points.map((p) => p.usedBytes);
    const n = points.length;

    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    if (den === 0) return undefined;

    const bytesPerDay = num / den;
    if (!Number.isFinite(bytesPerDay)) return undefined;

    /*
     * Ignore drift below ~100 MB/day. Every filesystem wobbles by a few
     * megabytes as logs rotate, and extrapolating that noise produces
     * "full in 4 years" lines that are technically true and entirely useless.
     */
    const NOISE_FLOOR_BYTES_PER_DAY = 100 * 1024 * 1024;
    const direction: DiskTrend['direction'] =
      bytesPerDay > NOISE_FLOOR_BYTES_PER_DAY
        ? 'filling'
        : bytesPerDay < -NOISE_FLOOR_BYTES_PER_DAY
          ? 'draining'
          : 'stable';

    let daysUntilFull: number | undefined;
    if (direction === 'filling' && disk.freeBytes > 0) {
      const days = disk.freeBytes / bytesPerDay;
      // Beyond a year the estimate says nothing actionable.
      if (Number.isFinite(days) && days > 0 && days < 365) {
        daysUntilFull = Math.round(days * 10) / 10;
      }
    }

    return {
      mountPoint: disk.mountPoint,
      bytesPerDay: Math.round(bytesPerDay),
      direction,
      daysUntilFull,
      sampleCount: n,
      spanHours: Math.round(spanMs / HOUR),
    };
  }

  /* ------------------------------ persistence ------------------------------ */

  private load(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as PersistedShape;
      if (parsed?.version !== 1 || !parsed.mounts) return;

      for (const [mountPoint, points] of Object.entries(parsed.mounts)) {
        if (!Array.isArray(points)) continue;
        this.series.set(
          mountPoint,
          points.filter(
            (p) =>
              p &&
              typeof p.t === 'number' &&
              typeof p.usedBytes === 'number' &&
              typeof p.totalBytes === 'number'
          )
        );
      }
      this.prune(Date.now());
    } catch (err) {
      // Losing fill history must never stop the server booting.
      logger.warn('disktrend', 'Could not read disk trend file', err);
    }
  }

  private maybeSave(): void {
    if (Date.now() - this.lastSaveAt < 5 * 60_000) return;
    this.save();
  }

  save(): void {
    if (!this.filePath || !this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const payload: PersistedShape = {
        version: 1,
        mounts: Object.fromEntries(this.series),
      };
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmp, this.filePath);

      this.dirty = false;
      this.lastSaveAt = Date.now();
    } catch (err) {
      logger.error('disktrend', 'Failed to persist disk trend', err);
    }
  }

  /** Closes open buckets and writes to disk. Called on shutdown. */
  flushAndSave(): void {
    for (const [mountPoint, bucket] of this.open) {
      this.closeBucket(mountPoint, bucket);
    }
    this.open.clear();
    this.dirty = true;
    this.save();
  }
}

const DATA_DIR = process.env.DATA_DIR || '/data';

function resolveTrendPath(): string {
  if (fs.existsSync(DATA_DIR)) return path.join(DATA_DIR, 'disktrend.json');
  return path.join(process.cwd(), 'data', 'disktrend.json');
}

export const diskTrends = new DiskTrendStore(resolveTrendPath());
