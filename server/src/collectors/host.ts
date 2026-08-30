import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HostTelemetry, MemoryInfo, ThermalSensor, FanSensor, NetworkInterface, CpuThrottle } from '../types.js';

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

/**
 * Share of the interval spent in a single CPU state.
 *
 * `calcStatDelta` deliberately folds iowait into idle, which is the right
 * convention for "utilisation" but hides the one number that matters on a
 * disk-bound machine: a host can sit at 3% CPU while every task is blocked on a
 * spinning disk. iowait is already parsed, so reporting it costs nothing.
 */
function statePercent(prev: CpuStat, curr: CpuStat, key: 'iowait' | 'steal'): number {
  const total = (s: CpuStat) =>
    s.user + s.nice + s.system + s.idle + s.iowait + s.irq + s.softirq + s.steal;

  const totalDiff = total(curr) - total(prev);
  if (totalDiff <= 0) return 0;

  const stateDiff = curr[key] - prev[key];
  return Math.max(0, Math.round((stateDiff / totalDiff) * 1000) / 10);
}

function parseProcStat(): {
  totalUsage: number;
  cores: number[];
  iowaitPercent: number;
  stealPercent: number;
} {
  const statContent = safeReadFile(path.join(PROC_DIR, 'stat'));
  if (!statContent) {
    const load = os.loadavg();
    const cpuCount = os.cpus().length || 8;
    const approxUsage = Math.min(100, Math.round((load[0] / cpuCount) * 100));
    return {
      totalUsage: approxUsage,
      cores: Array(cpuCount).fill(approxUsage),
      iowaitPercent: 0,
      stealPercent: 0,
    };
  }

  const lines = statContent.split('\n');
  const cpuLine = lines.find((l) => l.startsWith('cpu '));
  if (!cpuLine) {
    return { totalUsage: 0, cores: [], iowaitPercent: 0, stealPercent: 0 };
  }

  const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  const currentStat = parseStatLine(parts);

  let usagePercent = 0;
  let iowaitPercent = 0;
  let stealPercent = 0;
  if (lastCpuStat) {
    usagePercent = calcStatDelta(lastCpuStat, currentStat);
    iowaitPercent = statePercent(lastCpuStat, currentStat, 'iowait');
    stealPercent = statePercent(lastCpuStat, currentStat, 'steal');
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

  return {
    totalUsage: usagePercent,
    cores: cores.length > 0 ? cores : [usagePercent],
    iowaitPercent,
    stealPercent,
  };
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

/** Previous throttle counters, so we can tell "has ever throttled" from "is throttling now". */
let lastThrottle: { core: number; pkg: number } | null = null;

/**
 * Intel thermal-throttle counters, summed across cores.
 *
 * Temperature is a lagging and easily-missed signal: a 15-second sample can
 * sit at a comfortable number while the CPU is dropping clocks in bursts
 * between reads. These counters are monotonic, so any increase between two
 * samples is hard evidence the silicon stepped down -- which on a fanless or
 * lid-closed box is the thing you actually want alerting on.
 */
function parseThrottle(): CpuThrottle | undefined {
  const cpuDir = path.join(SYS_DIR, 'devices/system/cpu');
  let coreEvents = 0;
  let packageEvents = 0;
  let coreTotalTimeMs = 0;
  let packageTotalTimeMs = 0;
  let found = false;

  try {
    for (const entry of fs.readdirSync(cpuDir)) {
      if (!/^cpu\d+$/.test(entry)) continue;
      const tt = path.join(cpuDir, entry, 'thermal_throttle');
      const num = (f: string) => {
        const raw = safeReadFile(path.join(tt, f))?.trim();
        const n = raw ? parseInt(raw, 10) : NaN;
        return Number.isFinite(n) ? n : 0;
      };
      if (!fs.existsSync(tt)) continue;
      found = true;
      coreEvents += num('core_throttle_count');
      packageEvents += num('package_throttle_count');
      coreTotalTimeMs += num('core_throttle_total_time_ms');
      packageTotalTimeMs += num('package_throttle_total_time_ms');
    }
  } catch {
    return undefined;
  }
  if (!found) return undefined;

  const freq = (f: string) => {
    const raw = safeReadFile(path.join(cpuDir, 'cpu0/cpufreq', f))?.trim();
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? Math.round(n / 1000) : undefined;
  };

  const throttlingNow =
    lastThrottle !== null && (coreEvents > lastThrottle.core || packageEvents > lastThrottle.pkg);
  lastThrottle = { core: coreEvents, pkg: packageEvents };

  return {
    coreEvents,
    packageEvents,
    coreTotalTimeMs,
    packageTotalTimeMs,
    currentMhz: freq('scaling_cur_freq'),
    maxMhz: freq('cpuinfo_max_freq'),
    throttlingNow,
  };
}

/**
 * Sensors exposed under /sys/class/hwmon.
 *
 * This is where the good readings live. `/sys/class/thermal` on a typical Intel
 * laptop-turned-server offers only `acpitz` and a chipset zone, while hwmon
 * carries the `coretemp` driver — per-core temperatures plus the package
 * reading, which is the one worth alerting on. Each chip directory holds a
 * `name`, then `tempN_input` in millidegrees with an optional `tempN_label`.
 */
function parseHwmon(): ThermalSensor[] {
  const sensors: ThermalSensor[] = [];
  const hwmonDir = path.join(SYS_DIR, 'class/hwmon');

  try {
    if (!fs.existsSync(hwmonDir)) return sensors;

    for (const chip of fs.readdirSync(hwmonDir)) {
      const chipPath = path.join(hwmonDir, chip);
      const chipName = safeReadFile(path.join(chipPath, 'name'))?.trim() || chip;

      let entries: string[];
      try {
        entries = fs.readdirSync(chipPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const match = entry.match(/^temp(\d+)_input$/);
        if (!match) continue;

        const raw = safeReadFile(path.join(chipPath, entry))?.trim();
        if (!raw) continue;

        const tempC = Math.round((parseInt(raw, 10) / 1000) * 10) / 10;
        if (!Number.isFinite(tempC) || tempC <= 0 || tempC >= 150) continue;

        const label =
          safeReadFile(path.join(chipPath, `temp${match[1]}_label`))?.trim() ||
          `${chipName} ${match[1]}`;

        // A "critical" trip point, when the chip publishes one.
        const critRaw = safeReadFile(path.join(chipPath, `temp${match[1]}_crit`))?.trim();
        const critC = critRaw ? parseInt(critRaw, 10) / 1000 : 0;

        sensors.push({
          name: `${chip}/temp${match[1]}`,
          label: chipName === label ? label : `${chipName} ${label}`,
          tempC,
          isCritical: critC > 0 ? tempC >= critC * 0.95 : tempC >= 85,
        });
      }
    }
  } catch {
    // Unreadable hwmon tree; the thermal-zone reader below still applies.
  }

  return sensors;
}

function parseThermalZones(): ThermalSensor[] {
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

/**
 * Every temperature the host will report, hwmon first.
 *
 * hwmon is preferred because it carries the CPU package and per-core readings;
 * thermal zones fill in anything hwmon does not cover. Duplicate labels are
 * dropped so a chip exposed through both trees is listed once.
 */
function parseThermals(): ThermalSensor[] {
  const combined = [...parseHwmon(), ...parseThermalZones()];

  const seen = new Set<string>();
  const unique: ThermalSensor[] = [];
  for (const sensor of combined) {
    const key = sensor.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sensor);
  }

  // Package/CPU sensors lead, so the primary reading is picked first.
  return unique.sort((a, b) => {
    const rank = (s: ThermalSensor) =>
      /package|pkg|tctl|tdie/i.test(s.label) ? 0 : /core|cpu/i.test(s.label) ? 1 : 2;
    return rank(a) - rank(b);
  });
}

/**
 * Parses cooling fan speeds (RPM) from /sys/class/hwmon.
 */
function parseFans(): FanSensor[] {
  const fans: FanSensor[] = [];
  const hwmonDir = path.join(SYS_DIR, 'class/hwmon');

  try {
    if (!fs.existsSync(hwmonDir)) return fans;

    for (const chip of fs.readdirSync(hwmonDir)) {
      const chipPath = path.join(hwmonDir, chip);
      const chipName = safeReadFile(path.join(chipPath, 'name'))?.trim() || chip;

      let entries: string[];
      try {
        entries = fs.readdirSync(chipPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const match = entry.match(/^fan(\d+)_input$/);
        if (!match) continue;

        const raw = safeReadFile(path.join(chipPath, entry))?.trim();
        if (!raw) continue;

        const rpm = parseInt(raw, 10);
        if (!Number.isFinite(rpm) || rpm < 0) continue;

        const label =
          safeReadFile(path.join(chipPath, `fan${match[1]}_label`))?.trim() ||
          `${chipName} Fan ${match[1]}`;

        fans.push({
          name: `${chip}/fan${match[1]}`,
          label,
          rpm,
        });
      }
    }
  } catch {}

  return fans;
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
  const { totalUsage, cores, iowaitPercent, stealPercent } = parseProcStat();
  const memory = parseProcMeminfo();
  const loadAvg = parseLoadAvg();
  const uptime = parseUptime();
  const thermals = parseThermals();
  const fans = parseFans();
  const network = parseNetwork();

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';

  // The primary package temperature leads in sorted thermals
  const packageSensor = thermals.find((s) => /package|pkg|tctl|tdie/i.test(s.label)) || thermals[0];
  const packageTempC = packageSensor ? packageSensor.tempC : undefined;

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
      iowaitPercent,
      stealPercent,
    },
    packageTempC,
    memory,
    thermals,
    fans,
    throttle: parseThrottle(),
    network,
    timestamp: Date.now(),
  };
}
