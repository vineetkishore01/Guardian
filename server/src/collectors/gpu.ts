import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { GpuTelemetry } from '../types.js';

const execAsync = promisify(exec);
const SYS_DIR = process.env.HOST_SYS || '/sys';

let lastGpuCheckTime = 0;
let cachedGpus: GpuTelemetry[] = [];
let nvidiaSmiAvailable: boolean | null = null;

/** Previous RC6 idle-residency reading per card, for computing busy% between samples. */
const lastRc6 = new Map<string, { residencyMs: number; atMs: number }>();

/*
 * Intel i915 utilisation.
 *
 * i915 does not expose `gpu_busy_percent` -- that file is amdgpu-only, which is
 * why this collector previously reported a flat 0% on every Intel machine. What
 * i915 does expose is `rc6_residency_ms`: a monotonic counter of time spent in
 * the RC6 idle power state. Busy time is therefore wall-clock minus the RC6
 * delta, which needs two samples, so the first call after start returns
 * undefined rather than a fake zero.
 */
function readIntelUtilisation(cardDir: string, id: string): number | undefined {
  const candidates = [
    path.join(cardDir, 'power/rc6_residency_ms'),
    path.join(cardDir, 'gt/gt0/rc6_residency_ms'),
  ];
  let residencyMs: number | null = null;
  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      const v = parseInt(fs.readFileSync(f, 'utf8').trim(), 10);
      if (Number.isFinite(v)) { residencyMs = v; break; }
    } catch { /* try next */ }
  }
  if (residencyMs === null) return undefined;

  const now = Date.now();
  const prev = lastRc6.get(id);
  lastRc6.set(id, { residencyMs, atMs: now });
  if (!prev) return undefined;

  const wall = now - prev.atMs;
  const idle = residencyMs - prev.residencyMs;
  // Counter reset (suspend/resume) or a nonsensically short window.
  if (wall <= 0 || idle < 0) return undefined;

  return Math.max(0, Math.min(100, Math.round((1 - idle / wall) * 1000) / 10));
}

function readMhz(cardDir: string, file: string): number | undefined {
  try {
    const f = path.join(cardDir, file);
    if (!fs.existsSync(f)) return undefined;
    const v = parseInt(fs.readFileSync(f, 'utf8').trim(), 10);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Queries NVIDIA GPUs using nvidia-smi CLI.
 */
async function queryNvidiaGpus(): Promise<GpuTelemetry[]> {
  if (nvidiaSmiAvailable === false) return [];

  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=index,name,driver_version,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits',
      { timeout: 2000 }
    );
    nvidiaSmiAvailable = true;

    const lines = stdout.trim().split('\n').filter(Boolean);
    const gpus: GpuTelemetry[] = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 6) continue;

      const id = `gpu-${parts[0]}`;
      const name = parts[1] || 'NVIDIA GPU';
      const driver = parts[2] || undefined;
      const utilizationPercent = Math.max(0, Math.min(100, parseFloat(parts[3]) || 0));
      const memoryUsedMB = parseFloat(parts[4]) || 0;
      const memoryTotalMB = parseFloat(parts[5]) || 0;
      const memoryUsedBytes = memoryUsedMB * 1024 * 1024;
      const memoryTotalBytes = memoryTotalMB * 1024 * 1024;
      const memoryPercent =
        memoryTotalBytes > 0 ? Math.round((memoryUsedBytes / memoryTotalBytes) * 1000) / 10 : 0;
      const temperatureC = parseFloat(parts[6]) || undefined;
      const powerWatts = parts[7] && !parts[7].includes('N/A') ? parseFloat(parts[7]) : undefined;
      const fanSpeedPercent =
        parts[8] && !parts[8].includes('N/A') ? Math.min(100, parseFloat(parts[8])) : undefined;

      gpus.push({
        id,
        name,
        driver,
        utilizationPercent,
        memoryUsedBytes,
        memoryTotalBytes,
        memoryPercent,
        temperatureC: Number.isFinite(temperatureC) ? temperatureC : undefined,
        powerWatts: Number.isFinite(powerWatts) ? powerWatts : undefined,
        fanSpeedPercent: Number.isFinite(fanSpeedPercent) ? fanSpeedPercent : undefined,
      });
    }

    return gpus;
  } catch {
    // If nvidia-smi fails or is not in PATH, mark unavailable
    nvidiaSmiAvailable = false;
    return [];
  }
}

/**
 * Checks Linux DRM sysfs for Intel QuickSync / AMD GPU load & temperature.
 */
function querySysfsGpus(): GpuTelemetry[] {
  const gpus: GpuTelemetry[] = [];
  const drmDir = path.join(SYS_DIR, 'class/drm');

  try {
    if (!fs.existsSync(drmDir)) return gpus;
    const entries = fs.readdirSync(drmDir);

    for (const entry of entries) {
      if (!/^card\d+$/.test(entry)) continue;
      const cardPath = path.join(drmDir, entry, 'device');
      if (!fs.existsSync(cardPath)) continue;

      // amdgpu exposes a ready-made busy percentage; i915 does not.
      const cardDir = path.join(drmDir, entry);
      let utilizationPercent = 0;
      let utilisationKnown = false;
      const busyFile = path.join(cardPath, 'gpu_busy_percent');
      if (fs.existsSync(busyFile)) {
        const raw = fs.readFileSync(busyFile, 'utf8').trim();
        utilizationPercent = Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
        utilisationKnown = true;
      }

      // Check vendor name
      let name = 'Integrated GPU';
      const ueventFile = path.join(cardPath, 'uevent');
      if (fs.existsSync(ueventFile)) {
        const uevent = fs.readFileSync(ueventFile, 'utf8');
        if (uevent.includes('DRIVER=i915') || uevent.includes('DRIVER=xe')) {
          name = 'Intel HD/UHD Graphics';
        } else if (uevent.includes('DRIVER=amdgpu')) {
          name = 'AMD Radeon GPU';
        }
      }

      // Intel: derive utilisation from RC6 idle residency.
      const isIntel = name === 'Intel HD/UHD Graphics';
      if (isIntel && !utilisationKnown) {
        const intelUtil = readIntelUtilisation(cardDir, entry);
        if (intelUtil !== undefined) {
          utilizationPercent = intelUtil;
          utilisationKnown = true;
        }
      }
      const clockMhz = readMhz(cardDir, 'gt_act_freq_mhz') ?? readMhz(cardDir, 'gt_cur_freq_mhz');
      const clockMaxMhz = readMhz(cardDir, 'gt_max_freq_mhz') ?? readMhz(cardDir, 'gt_RP0_freq_mhz');

      // Check hwmon temperature if exposed
      let temperatureC: number | undefined;
      const hwmonPath = path.join(cardPath, 'hwmon');
      if (fs.existsSync(hwmonPath)) {
        try {
          const hwmonEntries = fs.readdirSync(hwmonPath);
          for (const hw of hwmonEntries) {
            const temp1 = path.join(hwmonPath, hw, 'temp1_input');
            if (fs.existsSync(temp1)) {
              const rawTemp = parseInt(fs.readFileSync(temp1, 'utf8').trim(), 10);
              if (rawTemp > 0) {
                temperatureC = Math.round((rawTemp / 1000) * 10) / 10;
              }
            }
          }
        } catch {}
      }

      // Only add if we could verify it's a real active card
      if (name !== 'Integrated GPU' || utilisationKnown || temperatureC) {
        gpus.push({
          id: entry,
          name,
          utilizationPercent,
          // Integrated parts carve out of system RAM; there is no separate pool
          // to report, so these stay zero and are flagged rather than shown.
          memoryUsedBytes: 0,
          memoryTotalBytes: 0,
          memoryPercent: 0,
          temperatureC,
          clockMhz,
          clockMaxMhz,
          sharedMemory: isIntel,
        });
      }
    }
  } catch {}

  return gpus;
}

/**
 * Collects live GPU telemetry across NVIDIA and integrated graphics.
 */
export async function collectGpuTelemetry(): Promise<GpuTelemetry[]> {
  const now = Date.now();
  // Cache for 1.5 seconds to avoid over-polling nvidia-smi
  if (now - lastGpuCheckTime < 1500 && cachedGpus.length > 0) {
    return cachedGpus;
  }

  const nvidia = await queryNvidiaGpus();
  if (nvidia.length > 0) {
    cachedGpus = nvidia;
    lastGpuCheckTime = now;
    return nvidia;
  }

  const sysfs = querySysfsGpus();
  cachedGpus = sysfs;
  lastGpuCheckTime = now;
  return sysfs;
}
