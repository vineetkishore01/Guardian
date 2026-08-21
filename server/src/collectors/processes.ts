import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProcessItem } from '../types.js';

const execFileAsync = promisify(execFile);
const PROC_DIR = process.env.HOST_PROC || '/proc';

interface PidPrev {
  totalTime: number; // utime + stime in clock ticks
  rxBytes?: number;
  txBytes?: number;
  netRxRate?: number;
  netTxRate?: number;
  timestamp: number;
}

const prevPidStats = new Map<number, PidPrev>();

function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Parses /proc/uptime to get system uptime in seconds */
function getSystemUptime(): number {
  const content = safeReadFile(path.join(PROC_DIR, 'uptime'));
  if (content) {
    const parts = content.trim().split(/\s+/);
    const up = parseFloat(parts[0]);
    if (!Number.isNaN(up)) return up;
  }
  return os.uptime();
}

/** Parses total RAM from /proc/meminfo or os.totalmem() */
function getTotalMemoryBytes(): number {
  const content = safeReadFile(path.join(PROC_DIR, 'meminfo'));
  if (content) {
    const match = content.match(/MemTotal:\s+(\d+)\s+kB/i);
    if (match) {
      return parseInt(match[1], 10) * 1024;
    }
  }
  return os.totalmem();
}

/**
 * Parses /proc/[pid]/net/dev to sum total non-loopback RX & TX bytes
 */
function getProcessNetBytes(pidDir: string): { rx: number; tx: number } | null {
  const content = safeReadFile(path.join(pidDir, 'net', 'dev'));
  if (!content) return null;

  let totalRx = 0;
  let totalTx = 0;
  let hasIfaces = false;

  const lines = content.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const iface = line.slice(0, colonIdx).trim();
    if (iface === 'lo') continue;

    const fields = line.slice(colonIdx + 1).trim().split(/\s+/);
    if (fields.length >= 9) {
      const rx = parseInt(fields[0], 10);
      const tx = parseInt(fields[8], 10);
      if (!Number.isNaN(rx) && !Number.isNaN(tx)) {
        totalRx += rx;
        totalTx += tx;
        hasIfaces = true;
      }
    }
  }

  return hasIfaces ? { rx: totalRx, tx: totalTx } : null;
}

/**
 * Collects process list directly from Linux /proc filesystem (zero dependencies).
 */
async function collectProcessesFromProc(totalMemBytes: number): Promise<ProcessItem[]> {
  const entries = await fs.promises.readdir(PROC_DIR).catch(() => []);
  const pids: number[] = [];

  for (const entry of entries) {
    if (/^\d+$/.test(entry)) {
      pids.push(parseInt(entry, 10));
    }
  }

  if (pids.length === 0) return [];

  const now = Date.now();
  const uptime = getSystemUptime();
  const clkTck = 100; // Standard Linux USER_HZ
  const results: ProcessItem[] = [];
  const currentPids = new Set<number>();

  for (const pid of pids) {
    currentPids.add(pid);
    const pidDir = path.join(PROC_DIR, String(pid));
    const statContent = safeReadFile(path.join(pidDir, 'stat'));
    if (!statContent) continue;

    // The comm field is wrapped in parentheses and may contain spaces
    const openParen = statContent.indexOf('(');
    const closeParen = statContent.lastIndexOf(')');
    if (openParen === -1 || closeParen === -1 || closeParen <= openParen) continue;

    const comm = statContent.slice(openParen + 1, closeParen);
    const rest = statContent.slice(closeParen + 2).trim().split(/\s+/);

    // rest[0] = state
    // rest[1] = ppid
    // rest[11] = utime (field 14)
    // rest[12] = stime (field 15)
    // rest[19] = starttime (field 22)
    // rest[21] = rss in pages (field 24)
    const ppid = parseInt(rest[1] || '0', 10);
    const utime = parseInt(rest[11] || '0', 10);
    const stime = parseInt(rest[12] || '0', 10);
    const starttime = parseInt(rest[19] || '0', 10);
    const rssPages = parseInt(rest[21] || '0', 10);

    const totalTicks = utime + stime;

    // Compute CPU percentage
    let cpuPercent = 0;
    const prev = prevPidStats.get(pid);
    if (prev && now > prev.timestamp) {
      const deltaSec = (now - prev.timestamp) / 1000;
      if (deltaSec > 0) {
        const deltaTicks = totalTicks - prev.totalTime;
        cpuPercent = Math.max(0, (deltaTicks / clkTck / deltaSec) * 100);
      }
    } else {
      // Estimate based on process lifetime
      const procAgeSec = Math.max(1, uptime - starttime / clkTck);
      cpuPercent = Math.max(0, (totalTicks / clkTck / procAgeSec) * 100);
    }

    // Network stats
    const netBytes = getProcessNetBytes(pidDir);
    let netRxBytesPerSec = prev?.netRxRate;
    let netTxBytesPerSec = prev?.netTxRate;

    if (netBytes && prev && prev.rxBytes !== undefined && prev.txBytes !== undefined && now > prev.timestamp) {
      const deltaSec = (now - prev.timestamp) / 1000;
      if (deltaSec > 0) {
        netRxBytesPerSec = Math.max(0, Math.round((netBytes.rx - prev.rxBytes) / deltaSec));
        netTxBytesPerSec = Math.max(0, Math.round((netBytes.tx - prev.txBytes) / deltaSec));
      }
    }

    prevPidStats.set(pid, {
      totalTime: totalTicks,
      rxBytes: netBytes?.rx,
      txBytes: netBytes?.tx,
      netRxRate: netRxBytesPerSec,
      netTxRate: netTxBytesPerSec,
      timestamp: now,
    });

    // Compute Memory bytes (from status or rss pages)
    let memBytes = rssPages * 4096;
    let user = 'root';

    const statusContent = safeReadFile(path.join(pidDir, 'status'));
    if (statusContent) {
      const vmRssMatch = statusContent.match(/VmRSS:\s+(\d+)\s+kB/i);
      if (vmRssMatch) {
        memBytes = parseInt(vmRssMatch[1], 10) * 1024;
      }
      const uidMatch = statusContent.match(/Uid:\s+(\d+)/);
      if (uidMatch) {
        const uid = parseInt(uidMatch[1], 10);
        user = uid === 0 ? 'root' : String(uid);
      }
    }

    const memPercent = totalMemBytes > 0 ? (memBytes / totalMemBytes) * 100 : 0;

    // Full command line
    const cmdlineRaw = safeReadFile(path.join(pidDir, 'cmdline'));
    let cmd = comm;
    if (cmdlineRaw) {
      const parsedCmd = cmdlineRaw.split('\0').filter(Boolean).join(' ').trim();
      if (parsedCmd) cmd = parsedCmd;
    }

    results.push({
      pid,
      ppid: ppid > 0 ? ppid : undefined,
      user,
      name: comm,
      cmd,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memPercent: Math.round(memPercent * 10) / 10,
      memBytes,
      netRxBytesPerSec,
      netTxBytesPerSec,
    });
  }

  // Prune dead PIDs from cache
  for (const pid of prevPidStats.keys()) {
    if (!currentPids.has(pid)) {
      prevPidStats.delete(pid);
    }
  }

  return results;
}

/**
 * Fallback parser using `ps` on macOS or environments where procfs is unavailable.
 */
async function collectProcessesFromPs(totalMemBytes: number): Promise<ProcessItem[]> {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-axo',
      'pid,ppid,user,%cpu,%mem,rss,comm,args',
    ]);
    const lines = stdout.trim().split('\n');
    const results: ProcessItem[] = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const ppid = parseInt(match[2], 10);
        const user = match[3];
        const cpuPercent = parseFloat(match[4]);
        const memPercent = parseFloat(match[5]);
        const rssKb = parseInt(match[6], 10);
        const comm = path.basename(match[7]);
        const cmd = match[8];

        results.push({
          pid,
          ppid: ppid > 0 ? ppid : undefined,
          user,
          name: comm,
          cmd,
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memPercent: Math.round(memPercent * 10) / 10,
          memBytes: rssKb * 1024,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Collects and returns the top system processes sorted by CPU, Memory, or Network.
 */
export async function collectTopProcesses(
  sortBy: 'cpu' | 'mem' | 'net' = 'cpu',
  limit: number = 30,
  search?: string
): Promise<ProcessItem[]> {
  const totalMem = getTotalMemoryBytes();
  let processes: ProcessItem[] = [];

  if (fs.existsSync(path.join(PROC_DIR, 'stat'))) {
    processes = await collectProcessesFromProc(totalMem);
  }

  if (processes.length === 0) {
    processes = await collectProcessesFromPs(totalMem);
  }

  if (search) {
    const q = search.toLowerCase();
    processes = processes.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.cmd.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        String(p.pid).includes(q)
    );
  }

  if (sortBy === 'mem') {
    processes.sort((a, b) => b.memBytes - a.memBytes);
  } else if (sortBy === 'net') {
    processes.sort(
      (a, b) =>
        ((b.netRxBytesPerSec || 0) + (b.netTxBytesPerSec || 0)) -
        ((a.netRxBytesPerSec || 0) + (a.netTxBytesPerSec || 0))
    );
  } else {
    processes.sort((a, b) => b.cpuPercent - a.cpuPercent);
  }

  return processes.slice(0, Math.max(1, limit));
}
