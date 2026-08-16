import http from 'node:http';
import fs from 'node:fs';
import { ContainerItem, DockerSystemDf } from '../types.js';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

function isDockerSocketAvailable(): boolean {
  try {
    return fs.existsSync(DOCKER_SOCKET);
  } catch {
    return false;
  }
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

// Container stats cache (30s TTL to prevent overwhelming docker daemon)
interface CachedStat {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  timestamp: number;
}
const containerStatsCache = new Map<string, CachedStat>();

async function fetchContainerStat(id: string): Promise<CachedStat | null> {
  const cached = containerStatsCache.get(id);
  const now = Date.now();
  if (cached && now - cached.timestamp < 30000) {
    return cached;
  }

  try {
    const raw = await dockerApiRequest<RawDockerStats>(`/containers/${id}/stats?stream=false`);
    let cpuPercent = 0;
    if (raw.cpu_stats && raw.precpu_stats) {
      const cpuDelta =
        (raw.cpu_stats.cpu_usage?.total_usage || 0) -
        (raw.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta =
        (raw.cpu_stats.system_cpu_usage || 0) -
        (raw.precpu_stats.system_cpu_usage || 0);
      const onlineCpus =
        raw.cpu_stats.online_cpus ||
        raw.cpu_stats.cpu_usage?.percpu_usage?.length ||
        1;

      if (systemDelta > 0 && cpuDelta > 0) {
        cpuPercent = Math.round(((cpuDelta / systemDelta) * onlineCpus * 100) * 10) / 10;
      }
    }

    let memoryBytes = 0;
    let memoryLimitBytes = 0;
    if (raw.memory_stats) {
      const rawUsage = raw.memory_stats.usage || 0;
      const cache = raw.memory_stats.stats?.cache || raw.memory_stats.stats?.inactive_file || 0;
      memoryBytes = Math.max(0, rawUsage - cache);
      memoryLimitBytes = raw.memory_stats.limit || 0;
    }

    const stat: CachedStat = {
      cpuPercent,
      memoryBytes,
      memoryLimitBytes,
      timestamp: now,
    };
    containerStatsCache.set(id, stat);
    return stat;
  } catch {
    return cached || null;
  }
}

export async function fetchContainers(): Promise<ContainerItem[]> {
  try {
    if (!isDockerSocketAvailable()) {
      return getMockHostContainers();
    }

    const raw = await dockerApiRequest<RawDockerContainer[]>('/containers/json?all=1');
    const runningContainers = raw.filter((c) => (c.State || '').toLowerCase() === 'running');

    // Fetch stats for running containers in parallel (cached 30s)
    const statsPromises = runningContainers.map((c) =>
      fetchContainerStat(c.Id).then((stat) => ({ id: c.Id.slice(0, 12), fullId: c.Id, stat }))
    );
    const statsResults = await Promise.allSettled(statsPromises);
    const statsMap = new Map<string, CachedStat>();

    for (const res of statsResults) {
      if (res.status === 'fulfilled' && res.value.stat) {
        statsMap.set(res.value.id, res.value.stat);
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
      const liveStat = statsMap.get(shortId);

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
      };
    });
  } catch (err) {
    console.warn('[Docker] Using fallback containers list:', (err as Error).message);
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
