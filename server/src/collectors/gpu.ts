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

      // Check busy percent (AMD / Intel i915)
      let utilizationPercent = 0;
      const busyFile = path.join(cardPath, 'gpu_busy_percent');
      if (fs.existsSync(busyFile)) {
        const raw = fs.readFileSync(busyFile, 'utf8').trim();
        utilizationPercent = Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
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
      if (name !== 'Integrated GPU' || utilizationPercent > 0 || temperatureC) {
        gpus.push({
          id: entry,
          name,
          utilizationPercent,
          memoryUsedBytes: 0,
          memoryTotalBytes: 0,
          memoryPercent: 0,
          temperatureC,
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
