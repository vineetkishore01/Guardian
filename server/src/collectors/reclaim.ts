import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ContainerItem, ReclaimReport, ReclaimEntry } from '../types.js';
import { fetchContainerMounts } from './docker.js';
import { logger } from '../logger.js';

/*
 * "What on this disk is safe to delete?"
 *
 * Download folders accumulate forever. A grab completes and is imported, a
 * release is superseded, a torrent is abandoned -- and the folder stays. Nothing
 * in the stack considers that its job, so the answer has historically been a
 * hand-written script, rerun from scratch every time the volume fills.
 *
 * The classification is a cross-reference, not a guess:
 *
 *   - The download client is asked what it is still managing. Anything on disk
 *     it does not recognise is no longer being seeded or downloaded.
 *   - Hard link counts say whether a file is *also* in the library. On a single
 *     filesystem an import should link rather than copy, so nlink > 1 means the
 *     bytes are shared and deleting the download frees nothing. nlink == 1 on a
 *     completed, imported download means it was copied -- the same bytes are on
 *     disk twice.
 *
 * That second signal turned out to matter more than the first on the host this
 * was written for: nothing was linked at all, so every imported film occupied
 * its space twice over. That is invisible in a disk-usage gauge and obvious
 * here.
 *
 * This is deliberately report-only. It has no delete endpoint and the volume it
 * reads is mounted read-only. Getting "safe to reclaim" wrong by one entry means
 * destroying something irreplaceable, so the tool points and the human decides.
 */

const SCAN_INTERVAL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 5000;
/** Guards against a pathological directory turning a scan into a hang. */
const MAX_ENTRIES = 200;
const MAX_DEPTH = 6;

const HOST_ROOT = process.env.HOST_ROOT || '/';

let latest: ReclaimReport | null = null;
let timer: NodeJS.Timeout | null = null;
let scanning = false;

export function getReclaimReport(): ReclaimReport | null {
  return latest;
}

/* --------------------------- qBittorrent client --------------------------- */

interface TorrentInfo {
  name?: string;
  state?: string;
  progress?: number;
  save_path?: string;
  content_path?: string;
}

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Invalid JSON'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Timed out'));
    });
  });
}

/* ------------------------------ path mapping ------------------------------ */

/**
 * Rewrites a container-namespace path into one this process can open.
 *
 * Two hops: the download client's own mount table maps `/downloads/x` to a host
 * path, and HOST_ROOT maps that host path into wherever `/` was bind-mounted.
 */
function toLocalPath(
  containerPath: string,
  mounts: Array<{ source: string; destination: string }>
): string | null {
  for (const mount of mounts) {
    if (containerPath === mount.destination || containerPath.startsWith(`${mount.destination}/`)) {
      const relative = containerPath.slice(mount.destination.length).replace(/^\//, '');
      const hostPath = relative ? path.join(mount.source, relative) : mount.source;
      return path.join(HOST_ROOT, hostPath);
    }
  }
  return null;
}

/* -------------------------------- scanning -------------------------------- */

interface DirStats {
  bytes: number;
  files: number;
  /** Files whose inode is referenced more than once, i.e. linked elsewhere. */
  linkedFiles: number;
  linkedBytes: number;
}

/**
 * Recursive size, counting each inode once.
 *
 * A hard-linked file appears under several names; adding it up per name would
 * double-count the very bytes this is trying to reason about.
 */
function measure(target: string, seen: Set<string>, depth = 0): DirStats {
  const out: DirStats = { bytes: 0, files: 0, linkedFiles: 0, linkedBytes: 0 };
  if (depth > MAX_DEPTH) return out;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      const sub = measure(full, seen, depth + 1);
      out.bytes += sub.bytes;
      out.files += sub.files;
      out.linkedFiles += sub.linkedFiles;
      out.linkedBytes += sub.linkedBytes;
      continue;
    }

    try {
      const st = fs.statSync(full);
      const key = `${st.dev}:${st.ino}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.bytes += st.size;
      out.files += 1;
      if (st.nlink > 1) {
        out.linkedFiles += 1;
        out.linkedBytes += st.size;
      }
    } catch {
      // Vanished mid-scan, or unreadable. Skip it.
    }
  }

  return out;
}

/* ------------------------------- the scan -------------------------------- */

/** States in which the client is still actively using the data on disk. */
const ACTIVE_STATES = new Set([
  'downloading',
  'metaDL',
  'forcedMetaDL',
  'forcedDL',
  'stalledDL',
  'queuedDL',
  'checkingDL',
  'checkingResumeData',
  'moving',
  'allocating',
  'uploading',
  'stalledUP',
  'forcedUP',
  'queuedUP',
  'checkingUP',
]);

/*
 * Seeding states: the download itself has finished.
 *
 * This matters for the hard link statistic. A torrent still downloading has no
 * business being linked into a library yet, so counting it as "not linked"
 * would report every healthy in-progress grab as a problem. Only a finished
 * download is a fair test of whether imports link or copy.
 *
 * qBittorrent 5 renamed pausedUP to stoppedUP; both spellings are accepted so
 * this does not silently stop recognising them on either side of that upgrade.
 */
const SEEDING_STATES = new Set([
  'uploading',
  'stalledUP',
  'forcedUP',
  'queuedUP',
  'checkingUP',
  'pausedUP',
  'stoppedUP',
]);

export async function runReclaimScan(containers: ContainerItem[]): Promise<ReclaimReport | null> {
  if (scanning) return latest;
  scanning = true;

  try {
    const client = containers.find(
      (c) =>
        c.state === 'running' &&
        (c.name.toLowerCase().includes('qbittorrent') || c.image.toLowerCase().includes('qbittorrent'))
    );
    if (!client) return null;

    const configured = client.integrationConfig?.url;
    const published = (client.ports || []).find((p) => p.publicPort)?.publicPort;
    const baseUrl = configured
      ? configured.replace(/\/$/, '')
      : published
        ? `http://127.0.0.1:${published}`
        : null;
    if (!baseUrl) return null;

    const [torrents, mounts] = await Promise.all([
      httpGetJson<TorrentInfo[]>(`${baseUrl}/api/v2/torrents/info`),
      fetchContainerMounts(client.id),
    ]);
    if (!Array.isArray(torrents)) return null;

    /*
     * The set of paths the client still considers its own. Compared by resolved
     * local path rather than by name: two torrents can share a display name, and
     * a folder can be renamed on disk without the client noticing.
     */
    const activePaths = new Set<string>();
    const stateByPath = new Map<string, string>();
    const seedingPaths = new Set<string>();
    const rootCandidates = new Set<string>();

    for (const t of torrents) {
      const contentPath = t.content_path;
      const savePath = t.save_path;
      if (savePath) {
        const localRoot = toLocalPath(savePath.replace(/\/$/, ''), mounts);
        if (localRoot) rootCandidates.add(localRoot);
      }
      if (!contentPath) continue;
      const local = toLocalPath(contentPath, mounts);
      if (!local) continue;
      activePaths.add(local);
      if (t.state) {
        stateByPath.set(local, t.state);
        if (SEEDING_STATES.has(t.state)) seedingPaths.add(local);
      }
    }

    if (rootCandidates.size === 0) return null;

    const entries: ReclaimEntry[] = [];
    const seenInodes = new Set<string>();
    let scannedRoots = 0;

    for (const root of rootCandidates) {
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      scannedRoots += 1;

      for (const dirent of dirents) {
        if (entries.length >= MAX_ENTRIES) break;
        if (dirent.isSymbolicLink()) continue;

        const full = path.join(root, dirent.name);

        /*
         * A nested save path is its own root and gets scanned on its own pass;
         * treating it as an entry here would double-count it and, worse, would
         * report the client's own incomplete-downloads folder as an orphan.
         */
        if (rootCandidates.has(full)) continue;

        const stats = measure(full, seenInodes);
        if (stats.files === 0 && stats.bytes === 0) continue;

        const isActive = activePaths.has(full);
        const torrentState = stateByPath.get(full);
        const isSeeding = seedingPaths.has(full);

        entries.push({
          name: dirent.name,
          path: full,
          bytes: stats.bytes,
          fileCount: stats.files,
          isActive,
          torrentState,
          isSeeding,
          linkedFiles: stats.linkedFiles,
          linkedBytes: stats.linkedBytes,
          /*
           * Only claim something is reclaimable when the client has forgotten
           * it entirely. A completed-but-linked download is also safe to remove,
           * but saying so is the client's business, not a filesystem scan's.
           */
          reclaimable: !isActive,
        });
      }
    }

    entries.sort((a, b) => b.bytes - a.bytes);

    const totalBytes = entries.reduce((a, e) => a + e.bytes, 0);
    const reclaimableEntries = entries.filter((e) => e.reclaimable);
    const totalFiles = entries.reduce((a, e) => a + e.fileCount, 0);
    const linkedFiles = entries.reduce((a, e) => a + e.linkedFiles, 0);

    /*
     * Restricted to finished downloads, so an in-progress grab is not counted
     * as evidence that imports are copying rather than linking.
     */
    const finished = entries.filter((e) => e.isSeeding);
    const finishedFiles = finished.reduce((a, e) => a + e.fileCount, 0);
    const finishedLinkedFiles = finished.reduce((a, e) => a + e.linkedFiles, 0);
    const finishedUnlinkedBytes = finished
      .filter((e) => e.linkedFiles === 0)
      .reduce((a, e) => a + e.bytes, 0);

    latest = {
      generatedAt: Date.now(),
      roots: [...rootCandidates],
      scannedRoots,
      totalBytes,
      entries,
      reclaimableBytes: reclaimableEntries.reduce((a, e) => a + e.bytes, 0),
      reclaimableCount: reclaimableEntries.length,
      totalFiles,
      linkedFiles,
      finishedFiles,
      finishedLinkedFiles,
      finishedUnlinkedBytes,
      source: 'qbittorrent',
    };
    return latest;
  } catch (err) {
    logger.warn('reclaim', 'Download scan failed', { message: (err as Error).message });
    return latest;
  } finally {
    scanning = false;
  }
}

/**
 * Starts the scan on its own timer.
 *
 * Kept off the telemetry loop on purpose. That loop runs every few seconds and
 * publishes the snapshot every reader depends on; hanging it on a directory walk
 * and two HTTP calls would make the whole dashboard as slow as the slowest thing
 * it monitors.
 */
export function startReclaimScanner(getContainers: () => ContainerItem[]): void {
  if (timer) return;

  const tick = () => {
    const containers = getContainers();
    if (containers.length === 0) return;
    runReclaimScan(containers).catch(() => {
      // Already logged; never allowed to reach the timer.
    });
  };

  // First pass shortly after boot, once the first sample has containers.
  setTimeout(tick, 20_000).unref();
  timer = setInterval(tick, SCAN_INTERVAL_MS);
  timer.unref();
}

export function stopReclaimScanner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
