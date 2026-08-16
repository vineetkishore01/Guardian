import http from 'node:http';
import fs from 'node:fs';
import { ContainerItem, DockerSystemDf, HealthProbe } from '../types.js';
import { logger } from '../logger.js';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

function isDockerSocketAvailable(): boolean {
  try {
    return fs.existsSync(DOCKER_SOCKET);
  } catch {
    return false;
  }
}

/**
 * Whether the numbers in this module came from a real daemon.
 *
 * When the socket is missing the collectors fall back to a sample container
 * list so the UI is developable off-host. That fallback is useful, but the
 * dashboard has to say so -- previously a demo machine rendered sixteen fake
 * containers indistinguishable from real ones.
 */
export function isDockerLive(): boolean {
  return isDockerSocketAvailable();
}

function dockerApiRequest<T>(path: string, method: string = 'GET', postData?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!isDockerSocketAvailable()) {
      return reject(new Error('Docker socket not available'));
    }

    let isSettled = false;
    const payload = postData ? JSON.stringify(postData) : null;
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: {
        Host: 'docker',
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (isSettled) return;
        isSettled = true;
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as unknown as T);
          }
        } else {
          reject(new Error(`Docker API error (${res.statusCode}): ${data.slice(0, 100)}`));
        }
      });
    });

    req.on('error', (err) => {
      if (isSettled) return;
      isSettled = true;
      reject(err);
    });

    req.setTimeout(4000, () => {
      if (isSettled) return;
      isSettled = true;
      req.destroy();
      reject(new Error('Docker API request timed out'));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

interface RawDockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels?: Record<string, string>;
  Ports?: Array<{
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
    IP?: string;
  }>;
}

interface RawDockerStats {
  cpu_stats?: {
    cpu_usage?: {
      total_usage?: number;
      percpu_usage?: number[];
    };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: {
      total_usage?: number;
    };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: {
      cache?: number;
      inactive_file?: number;
    };
  };
}

interface RawDockerSystemDf {
  Images?: Array<{
    Id: string;
    Size: number;
    SharedSize: number;
    Containers: number;
  }>;
  Containers?: Array<{
    Id: string;
    SizeRw?: number;
    SizeRootFs?: number;
  }>;
  Volumes?: Array<{
    Name: string;
    UsageData?: {
      Size: number;
      RefCount: number;
    };
  }>;
}

interface CachedStat {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  timestamp: number;
}

/** Turns one raw stats frame into the numbers the dashboard shows. */
function computeStat(raw: RawDockerStats, now: number): CachedStat {
  let cpuPercent = 0;
  if (raw.cpu_stats && raw.precpu_stats) {
    const cpuDelta =
      (raw.cpu_stats.cpu_usage?.total_usage || 0) -
      (raw.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta =
      (raw.cpu_stats.system_cpu_usage || 0) - (raw.precpu_stats.system_cpu_usage || 0);
    const onlineCpus =
      raw.cpu_stats.online_cpus || raw.cpu_stats.cpu_usage?.percpu_usage?.length || 1;

    if (systemDelta > 0 && cpuDelta > 0) {
      cpuPercent = Math.round((cpuDelta / systemDelta) * onlineCpus * 1000) / 10;
    }
  }

  let memoryBytes = 0;
  let memoryLimitBytes = 0;
  if (raw.memory_stats) {
    const rawUsage = raw.memory_stats.usage || 0;
    // Page cache is charged to the container but is reclaimable; excluding it
    // matches what `docker stats` reports.
    const cache = raw.memory_stats.stats?.cache ?? raw.memory_stats.stats?.inactive_file ?? 0;
    memoryBytes = Math.max(0, rawUsage - cache);
    memoryLimitBytes = raw.memory_stats.limit || 0;
  }

  return { cpuPercent, memoryBytes, memoryLimitBytes, timestamp: now };
}

/*
 * Streaming container stats.
 *
 * The previous approach issued one `stats?stream=false` request per container on
 * every poll. Docker holds each of those open for about a second while it
 * computes a CPU delta, so sixteen containers meant sixteen concurrent
 * connections and a second of latency every cycle -- and because the result was
 * then cached for 30s against a 15s sample interval, half the readings shown
 * were stale by construction.
 *
 * Instead we hold one long-lived streaming connection per running container and
 * keep the most recent frame. The daemon pushes roughly once a second, so the
 * dashboard always reads a fresh value, and the connection count is stable
 * rather than proportional to the poll rate.
 */
class ContainerStatsStreams {
  private streams = new Map<string, { req: http.ClientRequest; stopped: boolean }>();
  private latest = new Map<string, CachedStat>();
  private backoff = new Map<string, number>();

  /** Opens streams for newly-seen containers and closes those that vanished. */
  sync(runningIds: string[]): void {
    const wanted = new Set(runningIds);

    for (const id of this.streams.keys()) {
      if (!wanted.has(id)) this.stop(id);
    }
    for (const id of wanted) {
      if (!this.streams.has(id)) this.start(id);
    }
  }

  private start(id: string): void {
    if (!isDockerSocketAvailable()) return;

    const entry = { req: null as unknown as http.ClientRequest, stopped: false };

    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path: `/containers/${id}/stats?stream=true`,
        method: 'GET',
        headers: { Host: 'docker' },
      },
      (res) => {
        res.setEncoding('utf8');
        let buffer = '';

        res.on('data', (chunk: string) => {
          buffer += chunk;
          // Frames are newline-delimited JSON objects.
          let idx: number;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              this.latest.set(id, computeStat(JSON.parse(line) as RawDockerStats, Date.now()));
              this.backoff.delete(id);
            } catch {
              // A partial or malformed frame: skip it, keep the stream.
            }
          }
          // Guard against a frame that never terminates.
          if (buffer.length > 1_000_000) buffer = '';
        });

        res.on('end', () => this.reconnect(id, entry));
        res.on('error', () => this.reconnect(id, entry));
      }
    );

    entry.req = req;
    req.on('error', () => this.reconnect(id, entry));
    req.end();

    this.streams.set(id, entry);
  }

  /** Reopens a dropped stream with escalating delay, unless it was stopped. */
  private reconnect(id: string, entry: { stopped: boolean }): void {
    if (entry.stopped || !this.streams.has(id)) return;
    this.streams.delete(id);

    const attempt = (this.backoff.get(id) ?? 0) + 1;
    this.backoff.set(id, attempt);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));

    const timer = setTimeout(() => {
      // Only retry if the container is still expected to be running.
      if (!entry.stopped) this.start(id);
    }, delay);
    timer.unref?.();
  }

  private stop(id: string): void {
    const entry = this.streams.get(id);
    if (entry) {
      entry.stopped = true;
      try {
        entry.req.destroy();
      } catch {
        // Already closed.
      }
    }
    this.streams.delete(id);
    this.latest.delete(id);
    this.backoff.delete(id);
  }

  get(id: string): CachedStat | undefined {
    return this.latest.get(id);
  }

  stopAll(): void {
    for (const id of [...this.streams.keys()]) this.stop(id);
  }

  get openCount(): number {
    return this.streams.size;
  }
}

const statsStreams = new ContainerStatsStreams();

export function stopContainerStatsStreams(): void {
  statsStreams.stopAll();
}

export function containerStreamCount(): number {
  return statsStreams.openCount;
}

/* ------------------------------ inspect ------------------------------ */

interface RawInspect {
  Name?: string;
  RestartCount?: number;
  State?: {
    ExitCode?: number;
    Error?: string;
    OOMKilled?: boolean;
    StartedAt?: string;
    FinishedAt?: string;
    Health?: {
      Status?: string;
      Log?: Array<{ Start?: string; ExitCode?: number; Output?: string }>;
    };
  };
  HostConfig?: { NetworkMode?: string };
}

/** Docker uses a zero-ish sentinel for "never". */
function parseDockerTime(value?: string): number | undefined {
  if (!value || value.startsWith('0001-01-01')) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

export interface ContainerDetail {
  restartCount?: number;
  exitCode?: number;
  stateError?: string;
  oomKilled?: boolean;
  startedAt?: number;
  finishedAt?: number;
  healthLog?: HealthProbe[];
  networkMode?: string;
}

/**
 * The diagnostic half of a container's state.
 *
 * `/containers/json` reports a container as "running" even while it is
 * restart-looping, because between restarts it genuinely is. Restart count,
 * exit code, OOM flag and the healthcheck log all live here instead.
 */
async function fetchContainerDetail(id: string): Promise<ContainerDetail | null> {
  try {
    const raw = await dockerApiRequest<RawInspect>(`/containers/${id}/json`);
    const state = raw.State ?? {};

    return {
      restartCount: raw.RestartCount,
      exitCode: state.ExitCode,
      stateError: state.Error ? state.Error.slice(0, 300) : undefined,
      oomKilled: state.OOMKilled,
      startedAt: parseDockerTime(state.StartedAt),
      finishedAt: parseDockerTime(state.FinishedAt),
      networkMode: raw.HostConfig?.NetworkMode,
      healthLog: state.Health?.Log?.slice(-5).map((entry) => ({
        start: parseDockerTime(entry.Start) ?? 0,
        exitCode: entry.ExitCode ?? 0,
        output: (entry.Output ?? '').trim().slice(0, 500),
      })),
    };
  } catch {
    return null;
  }
}

export async function fetchContainers(): Promise<ContainerItem[]> {
  try {
    if (!isDockerSocketAvailable()) {
      return getMockHostContainers();
    }

    const raw = await dockerApiRequest<RawDockerContainer[]>('/containers/json?all=1');
    const runningContainers = raw.filter((c) => (c.State || '').toLowerCase() === 'running');

    // Keep one live stats stream per running container; reads are then free.
    statsStreams.sync(runningContainers.map((c) => c.Id));

    // Inspect every container each cycle. Unlike stats, inspect returns
    // immediately, so this stays cheap even for a few dozen containers -- and
    // a restart loop has to be caught promptly to be worth catching at all.
    const detailEntries = await Promise.allSettled(
      raw.map((c) => fetchContainerDetail(c.Id).then((d) => [c.Id, d] as const))
    );
    const detailMap = new Map<string, ContainerDetail>();
    for (const res of detailEntries) {
      if (res.status === 'fulfilled' && res.value[1]) {
        detailMap.set(res.value[0], res.value[1]);
      }
    }

    // Resolve `container:<id>` network modes to a readable container name, so a
    // service sharing a VPN gateway's namespace can say whose it is.
    const nameById = new Map<string, string>();
    for (const c of raw) {
      const n = c.Names?.[0]?.replace(/^\//, '');
      if (n) {
        nameById.set(c.Id, n);
        nameById.set(c.Id.slice(0, 12), n);
      }
    }

    return raw.map((c) => {
      const rawName = c.Names && c.Names[0] ? c.Names[0].replace(/^\//, '') : c.Id.slice(0, 12);
      const shortId = c.Id.slice(0, 12);

      let health: 'healthy' | 'unhealthy' | 'starting' | 'none' = 'none';
      const statusLower = (c.Status || '').toLowerCase();
      if (statusLower.includes('(healthy)')) {
        health = 'healthy';
      } else if (statusLower.includes('(unhealthy)')) {
        health = 'unhealthy';
      } else if (statusLower.includes('(health: starting)')) {
        health = 'starting';
      }

      const ports = (c.Ports || []).map((p) => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
        ip: p.IP,
      }));

      const state = (c.State || 'running').toLowerCase() as ContainerItem['state'];
      const liveStat = statsStreams.get(c.Id);
      const detail = detailMap.get(c.Id);

      // "container:abc123" — surface which container's network is shared.
      let networkParent: string | undefined;
      const nm = detail?.networkMode;
      if (nm?.startsWith('container:')) {
        const ref = nm.slice('container:'.length);
        networkParent = nameById.get(ref) ?? nameById.get(ref.slice(0, 12)) ?? ref.slice(0, 12);
      }

      return {
        id: shortId,
        name: rawName,
        image: c.Image,
        state: ['running', 'exited', 'restarting', 'paused', 'dead', 'created'].includes(state)
          ? state
          : 'running',
        status: c.Status || 'Up',
        health,
        created: c.Created,
        composeProject: c.Labels?.['com.docker.compose.project'],
        ports,
        cpuPercent: liveStat?.cpuPercent,
        memoryBytes: liveStat?.memoryBytes,
        memoryLimitBytes: liveStat?.memoryLimitBytes,
        statAgeMs: liveStat ? Date.now() - liveStat.timestamp : undefined,
        restartCount: detail?.restartCount,
        exitCode: detail?.exitCode,
        stateError: detail?.stateError,
        oomKilled: detail?.oomKilled,
        startedAt: detail?.startedAt,
        finishedAt: detail?.finishedAt,
        healthLog: detail?.healthLog,
        networkMode: detail?.networkMode,
        networkParent,
      };
    });
  } catch (err) {
    logger.warn('docker', 'Docker unreachable, using sample container list', err);
    return getMockHostContainers();
  }
}

export async function fetchDockerSystemDf(): Promise<DockerSystemDf | null> {
  try {
    if (!isDockerSocketAvailable()) {
      return getMockDockerDf();
    }

    const df = await dockerApiRequest<RawDockerSystemDf>('/system/df');
    let imagesTotal = 0;
    let imagesActive = 0;
    let imagesSize = 0;
    let imagesReclaimable = 0;

    if (df.Images) {
      imagesTotal = df.Images.length;
      for (const img of df.Images) {
        imagesSize += img.Size || 0;
        if (img.Containers > 0) {
          imagesActive += 1;
        } else {
          imagesReclaimable += img.Size || 0;
        }
      }
    }

    let containersTotal = 0;
    let containersActive = 0;
    let containersSize = 0;
    if (df.Containers) {
      containersTotal = df.Containers.length;
      containersActive = df.Containers.length;
      for (const c of df.Containers) {
        containersSize += c.SizeRw || 0;
      }
    }

    let volumesTotal = 0;
    let volumesSize = 0;
    let volumesReclaimable = 0;
    if (df.Volumes) {
      volumesTotal = df.Volumes.length;
      for (const v of df.Volumes) {
        const sz = v.UsageData?.Size || 0;
        volumesSize += sz;
        if (v.UsageData?.RefCount === 0) {
          volumesReclaimable += sz;
        }
      }
    }

    const reclaimableTotalBytes = imagesReclaimable + volumesReclaimable;
    const gb = (reclaimableTotalBytes / (1024 * 1024 * 1024)).toFixed(1);

    return {
      imagesTotal,
      imagesActive,
      imagesSize,
      imagesReclaimable,
      containersTotal,
      containersActive,
      containersSize,
      volumesTotal,
      volumesSize,
      volumesReclaimable,
      reclaimableTotalBytes,
      reclaimableFormatted: `${gb} GB`,
    };
  } catch {
    return getMockDockerDf();
  }
}

/** Raw (possibly multiplexed) request, used for the log stream. */
function dockerRawRequest(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!isDockerSocketAvailable()) {
      return reject(new Error('Docker socket not available'));
    }

    let settled = false;
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path, method: 'GET', headers: { Host: 'docker' } },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          // Hard ceiling so a chatty container cannot exhaust memory.
          if (size > 4 * 1024 * 1024) {
            res.destroy();
          }
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Docker API error (${res.statusCode}): ${body.toString('utf8', 0, 200)}`));
          }
        });
        res.on('close', () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks));
        });
      }
    );

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    req.setTimeout(8000, () => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error('Docker log request timed out'));
    });
    req.end();
  });
}

export interface ContainerLogLine {
  stream: 'stdout' | 'stderr';
  timestamp: string | null;
  message: string;
}

/**
 * Splits Docker's multiplexed log stream.
 *
 * When a container has no TTY, the daemon frames each chunk with an 8-byte
 * header: byte 0 is the stream (1=stdout, 2=stderr), bytes 4–7 are the payload
 * length, big-endian. With a TTY the output is raw. Reading the frames is what
 * lets stderr be distinguished from stdout, which is the whole point of a log
 * viewer for debugging.
 */
function demuxDockerLogs(buffer: Buffer): ContainerLogLine[] {
  const lines: ContainerLogLine[] = [];

  const pushRaw = (stream: 'stdout' | 'stderr', text: string) => {
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      // `timestamps=1` prefixes an RFC3339 stamp; split it off for display.
      const match = raw.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s?([\s\S]*)$/);
      lines.push({
        stream,
        timestamp: match ? match[1] : null,
        message: (match ? match[2] : raw).replace(/\r$/, ''),
      });
    }
  };

  let offset = 0;
  let framed = false;

  while (offset + 8 <= buffer.length) {
    const streamByte = buffer[offset];
    // A valid header has a known stream byte and three zero padding bytes.
    if (
      (streamByte === 1 || streamByte === 2) &&
      buffer[offset + 1] === 0 &&
      buffer[offset + 2] === 0 &&
      buffer[offset + 3] === 0
    ) {
      const length = buffer.readUInt32BE(offset + 4);
      if (offset + 8 + length > buffer.length) break;
      framed = true;
      pushRaw(
        streamByte === 2 ? 'stderr' : 'stdout',
        buffer.toString('utf8', offset + 8, offset + 8 + length)
      );
      offset += 8 + length;
    } else {
      break;
    }
  }

  // TTY containers emit an unframed stream; treat the whole body as stdout.
  if (!framed) {
    pushRaw('stdout', buffer.toString('utf8'));
  }

  return lines;
}

export async function fetchContainerLogs(
  idOrName: string,
  tail: number = 200
): Promise<ContainerLogLine[]> {
  const safeTail = Math.min(Math.max(Math.round(tail) || 200, 1), 2000);
  const buffer = await dockerRawRequest(
    `/containers/${encodeURIComponent(idOrName)}/logs?stdout=1&stderr=1&timestamps=1&tail=${safeTail}`
  );
  return demuxDockerLogs(buffer);
}

export async function pruneDockerImages(): Promise<{ spaceReclaimedBytes: number }> {
  try {
    if (!isDockerSocketAvailable()) {
      return { spaceReclaimedBytes: 16.4 * 1024 * 1024 * 1024 };
    }
    const res = await dockerApiRequest<{ SpaceReclaimed?: number }>(
      '/images/prune?filters=%7B%22dangling%22%3A%5B%22true%22%5D%7D',
      'POST'
    );
    return { spaceReclaimedBytes: res.SpaceReclaimed || 0 };
  } catch (err) {
    throw new Error(`Failed to prune Docker images: ${(err as Error).message}`);
  }
}

function getMockHostContainers(): ContainerItem[] {
  return [
    {
      id: 'c10101010101',
      name: 'jellyfin',
      image: 'jellyfin/jellyfin:latest',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8096, publicPort: 8096, type: 'tcp' }],
      cpuPercent: 1.2,
      memoryBytes: 180 * 1024 * 1024,
    },
    {
      id: 'c20202020202',
      name: 'seerr',
      image: 'fallenbagel/jellyseerr:latest',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 5055, publicPort: 5055, type: 'tcp' }],
      cpuPercent: 0.4,
      memoryBytes: 95 * 1024 * 1024,
    },
    {
      id: 'c30303030303',
      name: 'radarr',
      image: 'lscr.io/linuxserver/radarr:latest',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 7878, publicPort: 7878, type: 'tcp' }],
      cpuPercent: 0.3,
      memoryBytes: 110 * 1024 * 1024,
    },
    {
      id: 'c40404040404',
      name: 'sonarr',
      image: 'lscr.io/linuxserver/sonarr:latest',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8989, publicPort: 8989, type: 'tcp' }],
      cpuPercent: 0.3,
      memoryBytes: 115 * 1024 * 1024,
    },
    {
      id: 'c50505050505',
      name: 'prowlarr',
      image: 'lscr.io/linuxserver/prowlarr:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 9696, publicPort: 9696, type: 'tcp' }],
      cpuPercent: 0.2,
      memoryBytes: 75 * 1024 * 1024,
    },
    {
      id: 'c60606060606',
      name: 'bazarr',
      image: 'lscr.io/linuxserver/bazarr:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 6767, publicPort: 6767, type: 'tcp' }],
      cpuPercent: 0.2,
      memoryBytes: 68 * 1024 * 1024,
    },
    {
      id: 'c70707070707',
      name: 'qbittorrent',
      image: 'lscr.io/linuxserver/qbittorrent:latest',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8081, publicPort: 8081, type: 'tcp' }],
      cpuPercent: 0.8,
      memoryBytes: 140 * 1024 * 1024,
    },
    {
      id: 'c80808080808',
      name: 'homeassistant',
      image: 'ghcr.io/home-assistant/home-assistant:stable',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8123, publicPort: 8123, type: 'tcp' }],
      cpuPercent: 0.5,
      memoryBytes: 160 * 1024 * 1024,
    },
    {
      id: 'c90909090909',
      name: 'zennotes',
      image: 'zennotes:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8001, publicPort: 8001, type: 'tcp' }],
      cpuPercent: 0.1,
      memoryBytes: 42 * 1024 * 1024,
    },
    {
      id: 'ca0a0a0a0a0a',
      name: 'pelagica',
      image: 'pelagica:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8002, publicPort: 8002, type: 'tcp' }],
      cpuPercent: 0.1,
      memoryBytes: 38 * 1024 * 1024,
    },
    {
      id: 'cb0b0b0b0b0b',
      name: 'cleanuparr',
      image: 'cleanuparr:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 11011, publicPort: 11011, type: 'tcp' }],
      cpuPercent: 0.1,
      memoryBytes: 30 * 1024 * 1024,
    },
    {
      id: 'cc0c0c0c0c0c',
      name: 'trawl',
      image: 'trawl:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8191, publicPort: 8191, type: 'tcp' }],
      cpuPercent: 0.1,
      memoryBytes: 55 * 1024 * 1024,
    },
    {
      id: 'cd0d0d0d0d0d',
      name: 'llm-wiki-web',
      image: 'llm-wiki-web:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'llm-wiki',
      ports: [{ privatePort: 8080, publicPort: 8080, type: 'tcp' }],
      cpuPercent: 0.3,
      memoryBytes: 90 * 1024 * 1024,
    },
    {
      id: 'ce0e0e0e0e0e',
      name: 'code-server',
      image: 'lscr.io/linuxserver/code-server:latest',
      state: 'running',
      status: 'Up 2 days',
      health: 'none',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [{ privatePort: 8443, publicPort: 8443, type: 'tcp' }],
      cpuPercent: 0.2,
      memoryBytes: 120 * 1024 * 1024,
    },
    {
      id: 'cf0f0f0f0f0f',
      name: 'gluetun',
      image: 'qmcgaw/gluetun:latest',
      state: 'running',
      status: 'Up 2 days (healthy)',
      health: 'healthy',
      created: 1723500000,
      composeProject: 'media_stack',
      ports: [],
      cpuPercent: 0.1,
      memoryBytes: 25 * 1024 * 1024,
    },
  ];
}

function getMockDockerDf(): DockerSystemDf {
  return {
    imagesTotal: 47,
    imagesActive: 16,
    imagesSize: 28.99 * 1024 * 1024 * 1024,
    imagesReclaimable: 16.4 * 1024 * 1024 * 1024,
    containersTotal: 16,
    containersActive: 16,
    containersSize: 1.2 * 1024 * 1024 * 1024,
    volumesTotal: 12,
    volumesSize: 5.4 * 1024 * 1024 * 1024,
    volumesReclaimable: 0,
    reclaimableTotalBytes: 16.4 * 1024 * 1024 * 1024,
    reclaimableFormatted: '16.4 GB',
  };
}
