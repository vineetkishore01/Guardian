import fs from 'node:fs';
import path from 'node:path';
import { DiskMount } from '../types.js';

const ROOT_PATH = process.env.HOST_ROOT || '/';
const NAS_PATH = process.env.HOST_NAS || '/mnt/nas';

/** Extra mount points to watch, comma separated. */
const EXTRA_MOUNTS = (process.env.HOST_MOUNTS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const PROC_MOUNTS = path.join(process.env.HOST_PROC || '/proc', 'mounts');

/** Filesystems that are never interesting as "storage" in a dashboard. */
const PSEUDO_FS = new Set([
  'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'overlay',
  'squashfs', 'ramfs', 'securityfs', 'debugfs', 'tracefs', 'fusectl', 'configfs',
  'pstore', 'bpf', 'mqueue', 'hugetlbfs', 'autofs', 'binfmt_misc', 'efivarfs',
  'nsfs', 'rpc_pipefs',
]);

/** Paths that are internal bootloader or container runtime mounts and not user storage. */
const IGNORED_MOUNT_REGEX = /^\/(boot|efi)(\/|$)|^\/var\/(lib|snap)\/|\/docker/i;

interface MountInfo {
  mountPoint: string;
  device: string;
  fsType: string;
}

/**
 * Reads real mounts from /proc/mounts so the filesystem type and backing device
 * are reported accurately. The previous version guessed: any path containing
 * "nas" was labelled xfs on /dev/mapper/nas-lvm, everything else ext4 on
 * /dev/sda1, regardless of what was actually mounted.
 */
function readProcMounts(): Map<string, MountInfo> {
  const result = new Map<string, MountInfo>();
  try {
    if (!fs.existsSync(PROC_MOUNTS)) return result;
    const content = fs.readFileSync(PROC_MOUNTS, 'utf-8');
    for (const line of content.split('\n')) {
      const [device, mountPoint, fsType] = line.split(/\s+/);
      if (!device || !mountPoint || !fsType) continue;
      if (PSEUDO_FS.has(fsType)) continue;
      // Octal escapes for spaces and friends, as written by the kernel.
      const decoded = mountPoint.replace(/\\040/g, ' ').replace(/\\011/g, '\t');
      if (IGNORED_MOUNT_REGEX.test(decoded)) continue;
      result.set(decoded, { mountPoint: decoded, device, fsType });
    }
  } catch {
    // Not Linux, or /proc is not mounted.
  }
  return result;
}

/**
 * Translates a path as this process sees it into the path the host knows.
 *
 * In a container the root filesystem is bind-mounted at HOST_ROOT
 * (`/host/root`), so `/proc/mounts` — which is the *host's* table — lists it as
 * `/`. Without this mapping every filesystem would report a blank device and
 * type, and the root volume would be labelled "Root" instead of "System root".
 */
function toHostPath(containerPath: string): string {
  const prefixes: Array<[string, string]> = [
    [ROOT_PATH, '/'],
    [NAS_PATH, NAS_PATH],
  ];

  for (const [prefix, hostBase] of prefixes) {
    if (prefix === '/' || !prefix) continue;
    if (containerPath === prefix) return hostBase;
    if (containerPath.startsWith(`${prefix}/`)) {
      const suffix = containerPath.slice(prefix.length);
      return hostBase === '/' ? suffix : `${hostBase}${suffix}`;
    }
  }
  return containerPath;
}

function labelFor(hostPath: string): string {
  if (hostPath === '/') return 'System root';
  const base = hostPath.split('/').filter(Boolean).pop();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : hostPath;
}

const SYS_DIR = process.env.HOST_SYS || '/sys';

function getDiskTemperatures(): Map<string, number> {
  const map = new Map<string, number>();
  const hwmonDir = path.join(SYS_DIR, 'class/hwmon');
  try {
    if (!fs.existsSync(hwmonDir)) return map;
    for (const chip of fs.readdirSync(hwmonDir)) {
      const chipPath = path.join(hwmonDir, chip);
      const name = fs.readFileSync(path.join(chipPath, 'name'), 'utf8').trim();
      const temp1 = path.join(chipPath, 'temp1_input');
      if (fs.existsSync(temp1)) {
        const raw = parseInt(fs.readFileSync(temp1, 'utf8').trim(), 10);
        if (raw > 0 && raw < 120000) {
          const tempC = Math.round((raw / 1000) * 10) / 10;
          map.set(name, tempC);
          if (name.startsWith('nvme')) {
            map.set('nvme', tempC);
          }
        }
      }
    }
  } catch {}
  return map;
}

export function collectDiskUsage(): DiskMount[] {
  const procMounts = readProcMounts();
  const diskTemps = getDiskTemperatures();

  // Candidates: the root, the configured NAS path, any explicitly listed
  // mounts, plus everything real that /proc/mounts reports.
  const candidates = new Set<string>([ROOT_PATH, NAS_PATH, ...EXTRA_MOUNTS, ...procMounts.keys()]);

  const mounts: DiskMount[] = [];
  const seenDevices = new Set<string>();

  for (const mountPoint of candidates) {
    try {
      if (IGNORED_MOUNT_REGEX.test(mountPoint)) continue;
      if (!fs.existsSync(mountPoint)) continue;

      const hostPath = toHostPath(mountPoint);
      if (IGNORED_MOUNT_REGEX.test(hostPath)) continue;

      const label = labelFor(hostPath);
      if (label === 'Efi' || label === 'Boot') continue;

      const stat = fs.statfsSync(mountPoint);
      const totalBytes = Number(stat.bsize) * Number(stat.blocks);
      const freeBytes = Number(stat.bsize) * Number(stat.bavail);

      // Zero-sized filesystems are pseudo mounts that slipped through.
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue;

      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const usedPercent = Math.round((usedBytes / totalBytes) * 1000) / 10;

      // Look the mount up under the name the host uses for it.
      const info = procMounts.get(hostPath) ?? procMounts.get(mountPoint);
      if (info?.fsType === 'vfat' && totalBytes < 2 * 1024 * 1024 * 1024) continue;

      // Bind mounts and snapshots of the same device would otherwise appear
      // several times over.
      const dedupeKey = info?.device ?? `${hostPath}:${totalBytes}`;
      if (seenDevices.has(dedupeKey)) continue;
      seenDevices.add(dedupeKey);

      const devName = (info?.device || '').split('/').pop() || '';
      const tempC =
        diskTemps.get(devName) ??
        (devName.startsWith('nvme') ? diskTemps.get('nvme') : undefined) ??
        diskTemps.get('drivetemp');

      mounts.push({
        // Report the host's path — that is what the operator recognises.
        mountPoint: hostPath,
        label,
        device: info?.device ?? '',
        fsType: info?.fsType ?? '',
        totalBytes,
        usedBytes,
        freeBytes,
        usedPercent,
        tempC,
        isCritical: usedPercent >= 90,
        isWarning: usedPercent >= 80 && usedPercent < 90,
      });
    } catch {
      // Unreadable mount; skip it rather than substituting a guess.
    }
  }

  // Largest first, so the volume that matters leads.
  mounts.sort((a, b) => b.totalBytes - a.totalBytes);

  // Keep the view legible on hosts with many mounts.
  return mounts.slice(0, 6);
}
