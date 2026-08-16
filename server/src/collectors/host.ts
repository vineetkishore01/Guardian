import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HostTelemetry, MemoryInfo, ThermalSensor, NetworkInterface } from '../types.js';

const PROC_DIR = process.env.HOST_PROC || '/proc';
const SYS_DIR = process.env.HOST_SYS || '/sys';

interface CpuStat {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

let lastCpuStat: CpuStat | null = null;
const lastCoreStats = new Map<number, CpuStat>();
const lastNetStats: Record<string, { rx: number; tx: number; time: number }> = {};

function safeReadFile(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

function parseStatLine(parts: number[]): CpuStat {
  return {
    user: parts[0] || 0,
    nice: parts[1] || 0,
    system: parts[2] || 0,
    idle: parts[3] || 0,
    iowait: parts[4] || 0,
    irq: parts[5] || 0,
    softirq: parts[6] || 0,
    steal: parts[7] || 0,
  };
}

function calcStatDelta(prev: CpuStat, curr: CpuStat): number {
  const prevIdle = prev.idle + prev.iowait;
  const currIdle = curr.idle + curr.iowait;

  const prevNonIdle = prev.user + prev.nice + prev.system + prev.irq + prev.softirq + prev.steal;
  const currNonIdle = curr.user + curr.nice + curr.system + curr.irq + curr.softirq + curr.steal;

  const prevTotal = prevIdle + prevNonIdle;
  const currTotal = currIdle + currNonIdle;

  const totalDiff = currTotal - prevTotal;
  const idleDiff = currIdle - prevIdle;

  if (totalDiff > 0) {
    return Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 1000) / 10));
  }
  return 0;
}

function parseProcStat(): { totalUsage: number; cores: number[] } {
  const statContent = safeReadFile(path.join(PROC_DIR, 'stat'));
  if (!statContent) {
    const load = os.loadavg();
    const cpuCount = os.cpus().length || 8;
    const approxUsage = Math.min(100, Math.round((load[0] / cpuCount) * 100));
    return {
      totalUsage: approxUsage,
      cores: Array(cpuCount).fill(approxUsage),
    };
  }

  const lines = statContent.split('\n');
  const cpuLine = lines.find((l) => l.startsWith('cpu '));
  if (!cpuLine) {
    return { totalUsage: 0, cores: [] };
  }

  const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  const currentStat = parseStatLine(parts);

  let usagePercent = 0;
  if (lastCpuStat) {
    usagePercent = calcStatDelta(lastCpuStat, currentStat);
  }
  lastCpuStat = currentStat;

  // Read per-core lines (cpu0, cpu1, ...)
  const coreLines = lines.filter((l) => /^cpu\d+/.test(l));
  const cores: number[] = [];

  coreLines.forEach((l, idx) => {
    const cParts = l.trim().split(/\s+/).slice(1).map(Number);
    const currCoreStat = parseStatLine(cParts);
    const prevCoreStat = lastCoreStats.get(idx);

    if (prevCoreStat) {
      cores.push(calcStatDelta(prevCoreStat, currCoreStat));
    } else {
      cores.push(usagePercent);
    }
    lastCoreStats.set(idx, currCoreStat);
  });

  return { totalUsage: usagePercent, cores: cores.length > 0 ? cores : [usagePercent] };
}

function parseProcMeminfo(): MemoryInfo {
  const memContent = safeReadFile(path.join(PROC_DIR, 'meminfo'));
  if (!memContent) {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      availableBytes: free,
      buffersBytes: 0,
      cachedBytes: 0,
      usedPercent: Math.round((used / total) * 1000) / 10,
      // Swap is not observable without /proc/meminfo. Report zero rather than
      // the previous invented "1.4 GB of 3 GB".
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapPercent: 0,
    };
  }

  const map: Record<string, number> = {};
  for (const line of memContent.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)\s*kB/);
    if (match) {
      map[match[1]] = parseInt(match[2], 10) * 1024;
    }
  }

  const total = map['MemTotal'] || os.totalmem();
  const free = map['MemFree'] || 0;
  const available = map['MemAvailable'] !== undefined ? map['MemAvailable'] : free;
  const buffers = map['Buffers'] || 0;
  const cached = map['Cached'] || 0;
  const used = Math.max(0, total - available);
  const usedPercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;

  const swapTotal = map['SwapTotal'] || 0;
  const swapFree = map['SwapFree'] || 0;
  const swapUsed = Math.max(0, swapTotal - swapFree);
  const swapPercent = swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0;

  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    availableBytes: available,
    buffersBytes: buffers,
    cachedBytes: cached,
    usedPercent,
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapUsed,
    swapPercent,
  };
}

function parseLoadAvg(): [number, number, number] {
  const loadContent = safeReadFile(path.join(PROC_DIR, 'loadavg'));
  if (loadContent) {
    const parts = loadContent.trim().split(/\s+/).map(Number);
    if (parts.length >= 3) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  const fallback = os.loadavg();
  return [Math.round(fallback[0] * 100) / 100, Math.round(fallback[1] * 100) / 100, Math.round(fallback[2] * 100) / 100];
}

function parseUptime(): { seconds: number; formatted: string } {
  const uptimeContent = safeReadFile(path.join(PROC_DIR, 'uptime'));
  let sec = 0;
  if (uptimeContent) {
    sec = Math.floor(parseFloat(uptimeContent.trim().split(/\s+/)[0]) || 0);
  } else {
    sec = Math.floor(os.uptime());
  }

  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return { seconds: sec, formatted: parts.join(' ') || '0m' };
}

function parseThermals(): ThermalSensor[] {
  const sensors: ThermalSensor[] = [];
  const thermalDir = path.join(SYS_DIR, 'class/thermal');

  try {
    if (fs.existsSync(thermalDir)) {
      const entries = fs.readdirSync(thermalDir);
      for (const entry of entries) {
        if (entry.startsWith('thermal_zone')) {
          const typeFile = path.join(thermalDir, entry, 'type');
          const tempFile = path.join(thermalDir, entry, 'temp');

          const type = safeReadFile(typeFile)?.trim() || entry;
          const tempRaw = safeReadFile(tempFile)?.trim();
          if (tempRaw) {
            const rawVal = parseInt(tempRaw, 10);
            const tempC = Math.round((rawVal / 1000) * 10) / 10;
            if (tempC > 0 && tempC < 120) {
              sensors.push({
                name: entry,
                label: type,
                tempC,
                isCritical: tempC >= 80,
              });
            }
          }
        }
      }
    }
  } catch {
    // Ignore error
  }

  // No invented readings. A machine without exposed thermal zones (a Mac, a
  // container without /sys, a VM) reports none, and the UI says so. Previously
  // this returned a fixed 47°C "x86_pkg_temp", which looked exactly like a real
  // measurement.
  return sensors;
}

function parseNetwork(): NetworkInterface[] {
  const netContent = safeReadFile(path.join(PROC_DIR, 'net/dev'));
  const results: NetworkInterface[] = [];
  const now = Date.now();

  if (netContent) {
    const lines = netContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([a-zA-Z0-9_-]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if (match) {
        const iface = match[1];
        if (iface.startsWith('lo') || iface.startsWith('veth') || iface.startsWith('br-')) continue;

        const rxTotal = parseInt(match[2], 10);
        const txTotal = parseInt(match[3], 10);

        let rxRate = 0;
        let txRate = 0;

        const prev = lastNetStats[iface];
        if (prev && now > prev.time) {
          const deltaSec = (now - prev.time) / 1000;
          if (deltaSec > 0) {
            rxRate = Math.max(0, Math.round((rxTotal - prev.rx) / deltaSec));
            txRate = Math.max(0, Math.round((txTotal - prev.tx) / deltaSec));
          }
        }

        lastNetStats[iface] = { rx: rxTotal, tx: txTotal, time: now };

        results.push({
          name: iface,
          rxBytesPerSec: rxRate,
          txBytesPerSec: txRate,
          rxTotalBytes: rxTotal,
          txTotalBytes: txTotal,
        });
      }
    }
  }

  // Same principle as thermals: report nothing rather than invent an "eno1"
  // pushing a plausible-looking 142 KB/s.
  return results;
}

/** Reads the distro name from /etc/os-release instead of asserting "Debian 13". */
function detectOsName(): string {
  const release = safeReadFile(path.join(process.env.HOST_ETC || '/etc', 'os-release'));
  if (release) {
    const pretty = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (pretty) return pretty[1];
    const name = release.match(/^NAME="?([^"\n]+)"?/m);
    if (name) return name[1];
  }
  return `${os.type()} ${os.release()}`;
}

/** True when the Linux procfs this collector depends on is actually readable. */
export function isHostDataLive(): boolean {
  return fs.existsSync(path.join(PROC_DIR, 'stat'));
}

export function collectHostTelemetry(): Omit<HostTelemetry, 'disks'> {
  const { totalUsage, cores } = parseProcStat();
  const memory = parseProcMeminfo();
  const loadAvg = parseLoadAvg();
  const uptime = parseUptime();
  const thermals = parseThermals();
  const network = parseNetwork();

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';

  return {
    hostname: os.hostname() || 'unknown',
    os: detectOsName(),
    kernel: os.release(),
    uptimeSeconds: uptime.seconds,
    uptimeFormatted: uptime.formatted,
    cpu: {
      usagePercent: totalUsage,
      cores,
      model: cpuModel,
      loadAvg,
    },
    memory,
    thermals,
    network,
    timestamp: Date.now(),
  };
}
