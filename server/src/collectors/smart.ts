import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  PhysicalDisk,
  PhysicalDiskPartition,
  SmartAttribute,
  DiskMount,
  DiskHealthStatus,
  DiskMediaType,
  DiskProtocol,
} from '../types.js';

const execFileAsync = promisify(execFile);

const SYS_DIR = process.env.HOST_SYS || '/sys';
const DEV_DIR = process.env.HOST_DEV || '/dev';

/** Cache SMART measurements for 60 seconds to avoid constant disk wakeups and spin-ups. */
let cachedDisks: PhysicalDisk[] = [];
let lastCheckTime = 0;
const SMART_CACHE_TTL_MS = 60000;

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

/** Check if smartctl is available on system. */
async function hasSmartctl(): Promise<boolean> {
  try {
    await execFileAsync('which', ['smartctl'], { timeout: 1500 });
    return true;
  } catch {
    // Also test common binary locations
    const candidates = ['/usr/sbin/smartctl', '/usr/bin/smartctl', '/sbin/smartctl'];
    for (const c of candidates) {
      if (fs.existsSync(c)) return true;
    }
    return false;
  }
}

/** Execute smartctl safely with a timeout. */
async function runSmartctl(args: string[]): Promise<any | null> {
  try {
    const { stdout } = await execFileAsync('smartctl', args, {
      timeout: 4500,
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    // smartctl uses bitmask exit codes: bit 0 and 1 are command line errors,
    // but bits 2-7 indicate SMART warnings/errors while still returning valid JSON!
    if (err && typeof err.stdout === 'string' && err.stdout.trim().startsWith('{')) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Scan devices via smartctl --scan -j */
async function scanSmartctlDevices(): Promise<Array<{ name: string; type?: string; protocol?: string }>> {
  const json = await runSmartctl(['--scan', '-j']);
  if (json && Array.isArray(json.devices)) {
    return json.devices.map((d: any) => ({
      name: d.name,
      type: d.type,
      protocol: d.protocol,
    }));
  }
  return [];
}

/** Extract temperature from hwmon directory if available. */
function getHwmonTemperatures(): Map<string, number> {
  const map = new Map<string, number>();
  const hwmonDir = path.join(SYS_DIR, 'class/hwmon');
  try {
    if (!fs.existsSync(hwmonDir)) return map;
    for (const chip of fs.readdirSync(hwmonDir)) {
      const chipPath = path.join(hwmonDir, chip);
      const name = safeReadFile(path.join(chipPath, 'name'))?.trim();
      if (!name) continue;

      const temp1 = path.join(chipPath, 'temp1_input');
      if (fs.existsSync(temp1)) {
        const raw = parseInt(safeReadFile(temp1)?.trim() || '0', 10);
        if (raw > 0 && raw < 120000) {
          const tempC = Math.round((raw / 1000) * 10) / 10;
          map.set(name, tempC);
        }
      }
    }
  } catch {
    // ignore
  }
  return map;
}

/**
 * Scan Linux /sys/block to identify all real block devices and their partitions.
 */
function scanSysBlockDevices(): Array<{
  name: string;
  device: string;
  sizeBytes: number;
  rotational: boolean;
  model: string;
  vendor: string;
  serial: string;
  partitions: string[];
}> {
  const blockDir = path.join(SYS_DIR, 'block');
  if (!fs.existsSync(blockDir)) return [];

  const results = [];
  try {
    const entries = fs.readdirSync(blockDir);
    for (const devName of entries) {
      // Physical devices match sd*, nvme*n*, vd*, xvd*, mmcblk*
      if (!/^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|xvd[a-z]+|mmcblk\d+)$/.test(devName)) {
        continue;
      }

      const devPath = path.join(blockDir, devName);
      const sizeSectors = parseInt(safeReadFile(path.join(devPath, 'size'))?.trim() || '0', 10);
      const sizeBytes = sizeSectors * 512;

      // 0-sized or virtual devices
      if (sizeBytes <= 0) continue;

      const rotationalStr = safeReadFile(path.join(devPath, 'queue/rotational'))?.trim();
      const rotational = rotationalStr === '1';

      const model =
        safeReadFile(path.join(devPath, 'device/model'))?.trim() ||
        safeReadFile(path.join(devPath, 'device/name'))?.trim() ||
        devName;
      const vendor = safeReadFile(path.join(devPath, 'device/vendor'))?.trim() || '';
      const serial =
        safeReadFile(path.join(devPath, 'device/serial'))?.trim() ||
        safeReadFile(path.join(devPath, 'device/wwid'))?.trim() ||
        '';

      // Find partitions in this block device folder (e.g. sda1, nvme0n1p1)
      const partitions: string[] = [];
      try {
        const subFiles = fs.readdirSync(devPath);
        for (const sub of subFiles) {
          if (sub.startsWith(devName) && sub !== devName && /^(sd[a-z]+\d+|nvme\d+n\d+p\d+|vd[a-z]+\d+)$/.test(sub)) {
            partitions.push(sub);
          }
        }
      } catch {
        // ignore
      }

      results.push({
        name: devName,
        device: `/dev/${devName}`,
        sizeBytes,
        rotational,
        model,
        vendor,
        serial,
        partitions,
      });
    }
  } catch {
    // ignore
  }

  return results;
}

/** Map SMART attributes from smartctl ATA table. */
function parseAtaAttributes(table: any[]): {
  attributes: SmartAttribute[];
  reallocated?: number;
  pending?: number;
  uncorrectable?: number;
  crcErrors?: number;
  powerOnHours?: number;
  tempC?: number;
  wearoutPercent?: number;
} {
  const attributes: SmartAttribute[] = [];
  let reallocated = 0;
  let pending = 0;
  let uncorrectable = 0;
  let crcErrors = 0;
  let powerOnHours: number | undefined;
  let tempC: number | undefined;
  let wearoutPercent: number | undefined;

  for (const attr of table) {
    const id = attr.id;
    const name = attr.name || `Attribute_${id}`;
    const value = attr.value ?? 100;
    const worst = attr.worst ?? 100;
    const threshold = attr.thresh ?? 0;
    const rawValue = attr.raw?.value ?? 0;
    const rawFormatted = attr.raw?.string ?? String(rawValue);

    let status: 'ok' | 'warn' | 'crit' = 'ok';
    if (threshold > 0 && value <= threshold) {
      status = 'crit';
    } else if (threshold > 0 && value <= threshold + 10) {
      status = 'warn';
    }

    // Check critical failure IDs
    if (id === 5) {
      // Reallocated Sectors Count
      reallocated = rawValue;
      if (rawValue > 0) status = 'crit';
    } else if (id === 197) {
      // Current Pending Sector Count
      pending = rawValue;
      if (rawValue > 0) status = 'crit';
    } else if (id === 198) {
      // Offline Uncorrectable
      uncorrectable = rawValue;
      if (rawValue > 0) status = 'crit';
    } else if (id === 199) {
      // UDMA CRC Error Count (SATA cable/controller issue)
      crcErrors = rawValue;
      if (rawValue > 0) status = 'warn';
    } else if (id === 9) {
      // Power-On Hours
      powerOnHours = rawValue;
    } else if (id === 194 || id === 190) {
      // Temperature
      const tempVal = rawValue & 0xff;
      if (tempVal > 0 && tempVal < 100) {
        tempC = tempVal;
      }
    } else if (id === 231 || id === 233 || id === 173) {
      // SSD Wearout / Life remaining
      // In many SSDs, value is % remaining.
      if (value >= 0 && value <= 100) {
        wearoutPercent = 100 - value;
      }
    }

    attributes.push({
      id,
      name,
      value,
      worst,
      threshold,
      rawValue,
      rawFormatted,
      status,
    });
  }

  return {
    attributes,
    reallocated,
    pending,
    uncorrectable,
    crcErrors,
    powerOnHours,
    tempC,
    wearoutPercent,
  };
}

/** Synthetic disks representation for macOS dev or demo off-host mode. */
function getSyntheticDisks(mounts: DiskMount[]): PhysicalDisk[] {
  const rootMount = mounts.find((m) => m.mountPoint === '/') || {
    mountPoint: '/',
    label: 'System root',
    totalBytes: 1000 * 1024 * 1024 * 1024,
    usedBytes: 340 * 1024 * 1024 * 1024,
    freeBytes: 660 * 1024 * 1024 * 1024,
    usedPercent: 34.0,
  };

  const nasMount = mounts.find((m) => m.mountPoint.includes('nas') || m.mountPoint.includes('storage')) || {
    mountPoint: '/mnt/nas',
    label: 'RamSetu Pool',
    totalBytes: 16000 * 1024 * 1024 * 1024,
    usedBytes: 10240 * 1024 * 1024 * 1024,
    freeBytes: 5760 * 1024 * 1024 * 1024,
    usedPercent: 64.0,
  };

  return [
    {
      device: '/dev/nvme0n1',
      name: 'nvme0n1',
      model: 'Samsung SSD 980 PRO 1TB',
      vendor: 'Samsung',
      serial: 'S5GXNF0R481923K',
      firmware: '5B2QGXA7',
      protocol: 'nvme',
      mediaType: 'nvme',
      rotational: false,
      rotationRate: 0,
      sizeBytes: 1000204886016,
      health: 'passed',
      healthMessage: 'SMART overall-health self-assessment test: PASSED',
      tempC: 36,
      powerOnHours: 9420,
      powerCycles: 58,
      wearoutPercent: 3,
      healthPercent: 97,
      tbw: 48.6,
      tbr: 62.4,
      reallocatedSectors: 0,
      pendingSectors: 0,
      uncorrectableSectors: 0,
      crcErrors: 0,
      mediaErrors: 0,
      criticalWarnings: 0,
      unsafeShutdowns: 8,
      partitions: [
        {
          device: '/dev/nvme0n1p2',
          name: 'nvme0n1p2',
          mountPoint: rootMount.mountPoint,
          label: rootMount.label,
          fsType: 'ext4',
          sizeBytes: rootMount.totalBytes,
          usedBytes: rootMount.usedBytes,
          freeBytes: rootMount.freeBytes,
          usedPercent: rootMount.usedPercent,
        },
      ],
      smartEnabled: true,
      isSynthetic: true,
      smartAttributes: [
        { id: 1, name: 'Critical Warning', value: 100, worst: 100, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 2, name: 'Composite Temperature', value: 36, worst: 52, threshold: 84, rawValue: 36, rawFormatted: '36 C', status: 'ok' },
        { id: 3, name: 'Available Spare', value: 100, worst: 100, threshold: 10, rawValue: 100, rawFormatted: '100%', status: 'ok' },
        { id: 4, name: 'Percentage Used', value: 3, worst: 3, threshold: 100, rawValue: 3, rawFormatted: '3%', status: 'ok' },
        { id: 5, name: 'Data Units Read', value: 100, worst: 100, threshold: 0, rawValue: 122000000, rawFormatted: '62.4 TB', status: 'ok' },
        { id: 6, name: 'Data Units Written', value: 100, worst: 100, threshold: 0, rawValue: 95000000, rawFormatted: '48.6 TB', status: 'ok' },
        { id: 7, name: 'Power On Hours', value: 100, worst: 100, threshold: 0, rawValue: 9420, rawFormatted: '9,420 hrs', status: 'ok' },
        { id: 8, name: 'Unsafe Shutdowns', value: 100, worst: 100, threshold: 0, rawValue: 8, rawFormatted: '8', status: 'ok' },
        { id: 9, name: 'Media Errors', value: 100, worst: 100, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
      ],
    },
    {
      device: '/dev/sda',
      name: 'sda',
      model: 'Seagate IronWolf Pro ST8000NE001',
      vendor: 'Seagate',
      serial: 'WSD190KA',
      firmware: 'EN02',
      protocol: 'sata',
      mediaType: 'hdd',
      rotational: true,
      rotationRate: 7200,
      sizeBytes: 8001563222016,
      health: 'passed',
      healthMessage: 'SMART overall-health self-assessment test: PASSED',
      tempC: 32,
      powerOnHours: 18450,
      powerCycles: 42,
      wearoutPercent: undefined,
      healthPercent: 100,
      tbw: undefined,
      tbr: undefined,
      reallocatedSectors: 0,
      pendingSectors: 0,
      uncorrectableSectors: 0,
      crcErrors: 0,
      mediaErrors: 0,
      unsafeShutdowns: 4,
      partitions: [
        {
          device: '/dev/sda1',
          name: 'sda1',
          mountPoint: nasMount.mountPoint,
          label: nasMount.label,
          fsType: 'xfs',
          sizeBytes: nasMount.totalBytes / 2,
          usedBytes: nasMount.usedBytes / 2,
          freeBytes: nasMount.freeBytes / 2,
          usedPercent: nasMount.usedPercent,
        },
      ],
      smartEnabled: true,
      isSynthetic: true,
      smartAttributes: [
        { id: 5, name: 'Reallocated Sector Ct', value: 100, worst: 100, threshold: 10, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 9, name: 'Power On Hours', value: 79, worst: 79, threshold: 0, rawValue: 18450, rawFormatted: '18,450 hrs', status: 'ok' },
        { id: 12, name: 'Power Cycle Count', value: 99, worst: 99, threshold: 0, rawValue: 42, rawFormatted: '42', status: 'ok' },
        { id: 194, name: 'Temperature Celsius', value: 68, worst: 58, threshold: 0, rawValue: 32, rawFormatted: '32 C', status: 'ok' },
        { id: 197, name: 'Current Pending Sector', value: 100, worst: 100, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 198, name: 'Offline Uncorrectable', value: 100, worst: 100, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 199, name: 'UDMA CRC Error Count', value: 200, worst: 200, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
      ],
    },
    {
      device: '/dev/sdb',
      name: 'sdb',
      model: 'WDC Red Plus WD80EFZZ-68BPTN0',
      vendor: 'Western Digital',
      serial: 'WD-WXD2A9103981',
      firmware: '83.00A83',
      protocol: 'sata',
      mediaType: 'hdd',
      rotational: true,
      rotationRate: 5640,
      sizeBytes: 8001563222016,
      health: 'passed',
      healthMessage: 'SMART overall-health self-assessment test: PASSED',
      tempC: 30,
      powerOnHours: 18440,
      powerCycles: 40,
      wearoutPercent: undefined,
      healthPercent: 100,
      tbw: undefined,
      tbr: undefined,
      reallocatedSectors: 0,
      pendingSectors: 0,
      uncorrectableSectors: 0,
      crcErrors: 0,
      mediaErrors: 0,
      unsafeShutdowns: 3,
      partitions: [
        {
          device: '/dev/sdb1',
          name: 'sdb1',
          mountPoint: nasMount.mountPoint,
          label: nasMount.label,
          fsType: 'xfs',
          sizeBytes: nasMount.totalBytes / 2,
          usedBytes: nasMount.usedBytes / 2,
          freeBytes: nasMount.freeBytes / 2,
          usedPercent: nasMount.usedPercent,
        },
      ],
      smartEnabled: true,
      isSynthetic: true,
      smartAttributes: [
        { id: 5, name: 'Reallocated Sector Ct', value: 200, worst: 200, threshold: 140, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 9, name: 'Power On Hours', value: 75, worst: 75, threshold: 0, rawValue: 18440, rawFormatted: '18,440 hrs', status: 'ok' },
        { id: 12, name: 'Power Cycle Count', value: 100, worst: 100, threshold: 0, rawValue: 40, rawFormatted: '40', status: 'ok' },
        { id: 194, name: 'Temperature Celsius', value: 120, worst: 110, threshold: 0, rawValue: 30, rawFormatted: '30 C', status: 'ok' },
        { id: 197, name: 'Current Pending Sector', value: 200, worst: 200, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 198, name: 'Offline Uncorrectable', value: 100, worst: 100, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
        { id: 199, name: 'UDMA CRC Error Count', value: 200, worst: 200, threshold: 0, rawValue: 0, rawFormatted: '0', status: 'ok' },
      ],
    },
  ];
}

/**
 * Collect physical disks and their SMART health data.
 */
export async function collectPhysicalDisks(mounts: DiskMount[] = []): Promise<PhysicalDisk[]> {
  const now = Date.now();
  if (cachedDisks.length > 0 && now - lastCheckTime < SMART_CACHE_TTL_MS) {
    return cachedDisks;
  }

  const hwmonTemps = getHwmonTemperatures();
  const sysBlocks = scanSysBlockDevices();
  const smartctlAvailable = await hasSmartctl();

  const disks: PhysicalDisk[] = [];
  const processedDevices = new Set<string>();

  if (smartctlAvailable) {
    const scannedDevices = await scanSmartctlDevices();
    for (const d of scannedDevices) {
      const devPath = d.name;
      const devBase = path.basename(devPath);
      processedDevices.add(devBase);

      try {
        let smartJson = await runSmartctl(['-a', '-j', devPath]);
        if (!smartJson && devPath.startsWith('/dev/sd')) {
          // Attempt SCSI-to-ATA translation for external USB bridges
          smartJson = await runSmartctl(['-a', '-j', '-d', 'sat', devPath]);
        }
        if (!smartJson) continue;

        const isPassed = smartJson.smart_status?.passed === true;
        let health: DiskHealthStatus = isPassed ? 'passed' : 'critical';

        const model = smartJson.model_name || smartJson.model_family || devBase;
        const vendor = smartJson.vendor || (model.includes(' ') ? model.split(' ')[0] : undefined);
        const serial = smartJson.serial_number;
        const firmware = smartJson.firmware_version;
        const sizeBytes = smartJson.user_capacity?.bytes || 0;

        let protocol: DiskProtocol = 'sata';
        const rawProto = (smartJson.device?.protocol || d.protocol || '').toLowerCase();
        if (rawProto.includes('nvme') || devBase.startsWith('nvme')) {
          protocol = 'nvme';
        } else if (rawProto.includes('sas')) {
          protocol = 'sas';
        } else if (rawProto.includes('scsi')) {
          protocol = 'scsi';
        } else if (rawProto.includes('usb')) {
          protocol = 'usb';
        }

        const isRotational = smartJson.rotation_rate !== undefined && smartJson.rotation_rate > 0;
        let mediaType: DiskMediaType = isRotational ? 'hdd' : protocol === 'nvme' ? 'nvme' : 'ssd';

        let tempC = smartJson.temperature?.current;
        if (!tempC) {
          tempC = hwmonTemps.get(devBase) ?? hwmonTemps.get('drivetemp');
        }

        let powerOnHours = smartJson.power_on_time?.hours;
        let powerCycles = smartJson.power_cycle_count;
        let wearoutPercent: number | undefined;
        let healthPercent: number | undefined;
        let tbw: number | undefined;
        let tbr: number | undefined;
        let reallocatedSectors: number | undefined;
        let pendingSectors: number | undefined;
        let uncorrectableSectors: number | undefined;
        let crcErrors: number | undefined;
        let mediaErrors: number | undefined;
        let criticalWarnings: number | undefined;
        let unsafeShutdowns: number | undefined;
        let smartAttributes: SmartAttribute[] | undefined;

        // NVMe health log
        if (smartJson.nvme_smart_health_information_log) {
          const nvmeLog = smartJson.nvme_smart_health_information_log;
          if (nvmeLog.temperature) tempC = nvmeLog.temperature;
          if (nvmeLog.power_on_hours) powerOnHours = nvmeLog.power_on_hours;
          if (nvmeLog.power_cycles) powerCycles = nvmeLog.power_cycles;
          if (nvmeLog.percentage_used !== undefined && typeof nvmeLog.percentage_used === 'number') {
            wearoutPercent = nvmeLog.percentage_used;
            healthPercent = Math.max(0, 100 - nvmeLog.percentage_used);
          }
          if (nvmeLog.data_units_written) {
            tbw = Math.round(((nvmeLog.data_units_written * 512000) / (1024 ** 4)) * 10) / 10;
          }
          if (nvmeLog.data_units_read) {
            tbr = Math.round(((nvmeLog.data_units_read * 512000) / (1024 ** 4)) * 10) / 10;
          }
          mediaErrors = nvmeLog.media_errors ?? 0;
          criticalWarnings = nvmeLog.critical_warning ?? 0;
          unsafeShutdowns = nvmeLog.unsafe_shutdowns;

          if ((criticalWarnings ?? 0) > 0 || (mediaErrors ?? 0) > 0) {
            health = 'critical';
          } else if (wearoutPercent !== undefined && wearoutPercent >= 90) {
            health = 'warning';
          }
        }

        // ATA SMART attributes
        if (Array.isArray(smartJson.ata_smart_attributes?.table)) {
          const parsed = parseAtaAttributes(smartJson.ata_smart_attributes.table);
          smartAttributes = parsed.attributes;
          if (parsed.reallocated !== undefined) reallocatedSectors = parsed.reallocated;
          if (parsed.pending !== undefined) pendingSectors = parsed.pending;
          if (parsed.uncorrectable !== undefined) uncorrectableSectors = parsed.uncorrectable;
          if (parsed.crcErrors !== undefined) crcErrors = parsed.crcErrors;
          if (parsed.powerOnHours !== undefined && !powerOnHours) powerOnHours = parsed.powerOnHours;
          if (parsed.tempC !== undefined && !tempC) tempC = parsed.tempC;
          if (parsed.wearoutPercent !== undefined) {
            wearoutPercent = parsed.wearoutPercent;
            healthPercent = Math.max(0, 100 - wearoutPercent);
          }

          if ((reallocatedSectors ?? 0) > 0 || (pendingSectors ?? 0) > 0 || (uncorrectableSectors ?? 0) > 0) {
            health = 'critical';
          } else if ((crcErrors ?? 0) > 0) {
            health = 'warning';
          }
        }

        // Map partitions from sysBlocks or device matching
        const sysBlock = sysBlocks.find((b) => b.name === devBase);
        const partitions: PhysicalDiskPartition[] = [];
        const partNames = sysBlock?.partitions || [];

        for (const pName of partNames) {
          const pDev = `/dev/${pName}`;
          const matchingMount = mounts.find((m) => m.device === pDev || m.device.endsWith(pName));
          partitions.push({
            device: pDev,
            name: pName,
            mountPoint: matchingMount?.mountPoint,
            label: matchingMount?.label,
            fsType: matchingMount?.fsType,
            sizeBytes: matchingMount?.totalBytes,
            usedBytes: matchingMount?.usedBytes,
            freeBytes: matchingMount?.freeBytes,
            usedPercent: matchingMount?.usedPercent,
          });
        }

        disks.push({
          device: devPath,
          name: devBase,
          model,
          vendor,
          serial,
          firmware,
          protocol,
          mediaType,
          rotational: isRotational,
          rotationRate: smartJson.rotation_rate,
          sizeBytes,
          health,
          healthMessage: smartJson.smart_status?.passed
            ? 'SMART overall-health self-assessment test: PASSED'
            : 'SMART self-assessment reporting FAILING status',
          tempC,
          powerOnHours,
          powerCycles,
          wearoutPercent,
          healthPercent,
          tbw,
          tbr,
          reallocatedSectors,
          pendingSectors,
          uncorrectableSectors,
          crcErrors,
          mediaErrors,
          criticalWarnings,
          unsafeShutdowns,
          partitions,
          smartAttributes,
          smartEnabled: smartJson.smart_support?.enabled ?? true,
          isSynthetic: false,
        });
      } catch {
        // Skip unreadable device
      }
    }
  }

  // Fallback for devices in /sys/block not read by smartctl
  for (const sysDev of sysBlocks) {
    if (processedDevices.has(sysDev.name)) continue;
    processedDevices.add(sysDev.name);

    const protocol: DiskProtocol = sysDev.name.startsWith('nvme') ? 'nvme' : 'sata';
    const mediaType: DiskMediaType = sysDev.rotational ? 'hdd' : protocol === 'nvme' ? 'nvme' : 'ssd';
    const tempC = hwmonTemps.get(sysDev.name) ?? hwmonTemps.get('drivetemp');

    const partitions: PhysicalDiskPartition[] = sysDev.partitions.map((pName) => {
      const pDev = `/dev/${pName}`;
      const matchingMount = mounts.find((m) => m.device === pDev || m.device.endsWith(pName));
      return {
        device: pDev,
        name: pName,
        mountPoint: matchingMount?.mountPoint,
        label: matchingMount?.label,
        fsType: matchingMount?.fsType,
        sizeBytes: matchingMount?.totalBytes,
        usedBytes: matchingMount?.usedBytes,
        freeBytes: matchingMount?.freeBytes,
        usedPercent: matchingMount?.usedPercent,
      };
    });

    disks.push({
      device: sysDev.device,
      name: sysDev.name,
      model: sysDev.model,
      vendor: sysDev.vendor || undefined,
      serial: sysDev.serial || undefined,
      protocol,
      mediaType,
      rotational: sysDev.rotational,
      sizeBytes: sysDev.sizeBytes,
      health: 'passed',
      healthMessage: 'Kernel block device active (smartctl not installed)',
      tempC,
      partitions,
      smartEnabled: false,
      isSynthetic: false,
    });
  }

  // If no disks were detected (e.g. running off-host on macOS or dev container without proc/sys/block)
  if (disks.length === 0) {
    cachedDisks = getSyntheticDisks(mounts);
    lastCheckTime = now;
    return cachedDisks;
  }

  // Sort: NVMe first, then SSDs, then HDDs by size descending
  disks.sort((a, b) => {
    if (a.protocol === 'nvme' && b.protocol !== 'nvme') return -1;
    if (b.protocol === 'nvme' && a.protocol !== 'nvme') return 1;
    return b.sizeBytes - a.sizeBytes;
  });

  cachedDisks = disks;
  lastCheckTime = now;
  return disks;
}

/** Invalidate cache and re-collect physical disks immediately. */
export async function refreshPhysicalDisks(mounts: DiskMount[] = []): Promise<PhysicalDisk[]> {
  lastCheckTime = 0;
  return collectPhysicalDisks(mounts);
}
