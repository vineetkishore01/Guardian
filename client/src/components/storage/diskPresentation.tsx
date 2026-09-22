import React from 'react';
import {
  HardDrive,
  Disc,
  Layers,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
} from 'lucide-react';
import { PhysicalDisk } from '../../types/dashboard';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';

export function formatPowerHours(hours?: number): string {
  if (hours === undefined || !Number.isFinite(hours)) return '—';
  if (hours >= 8760) {
    const years = (hours / 8760).toFixed(1);
    return `${hours.toLocaleString()}h (~${years}y)`;
  }
  if (hours >= 24) {
    const days = Math.round(hours / 24);
    return `${hours.toLocaleString()}h (~${days}d)`;
  }
  return `${hours}h`;
}

export function getDriveIcon(disk: PhysicalDisk, className: string = 'h-4 w-4') {
  if (disk.protocol === 'nvme' || disk.mediaType === 'nvme') {
    return <Layers className={cn(className, 'text-brand')} aria-hidden="true" />;
  }
  if (disk.rotational || disk.mediaType === 'hdd') {
    return <Disc className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
  }
  return <HardDrive className={cn(className, 'text-brand')} aria-hidden="true" />;
}

export function getMediaLabel(disk: PhysicalDisk): string {
  if (disk.protocol === 'nvme' || disk.mediaType === 'nvme') {
    return 'NVMe PCIe SSD';
  }
  if (disk.rotational || disk.mediaType === 'hdd') {
    return disk.rotationRate ? `${disk.rotationRate.toLocaleString()} RPM HDD` : 'Spinning HDD';
  }
  return 'SATA SSD';
}

export function getHealthBadge(health: PhysicalDisk['health']) {
  switch (health) {
    case 'passed':
      return (
        <Badge variant="ok" className="gap-1 font-mono text-2xs">
          <CheckCircle2 className="h-2.5 w-2.5" />
          PASSED
        </Badge>
      );
    case 'warning':
      return (
        <Badge variant="warn" className="gap-1 font-mono text-2xs">
          <AlertTriangle className="h-2.5 w-2.5" />
          WARNING
        </Badge>
      );
    case 'critical':
      return (
        <Badge variant="crit" className="gap-1 font-mono text-2xs">
          <AlertOctagon className="h-2.5 w-2.5" />
          FAILING
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="font-mono text-2xs">
          UNKNOWN
        </Badge>
      );
  }
}

export type DiskTempSeverity = 'ok' | 'warn' | 'crit' | null;

export function getTempSeverity(temp?: number): DiskTempSeverity {
  if (temp === undefined || !Number.isFinite(temp)) return null;
  if (temp >= 55) return 'crit';
  if (temp >= 45) return 'warn';
  return 'ok';
}

export function getMediaBucket(disk: PhysicalDisk): 'nvme' | 'ssd' | 'hdd' {
  if (disk.protocol === 'nvme' || disk.mediaType === 'nvme') return 'nvme';
  if (disk.rotational || disk.mediaType === 'hdd') return 'hdd';
  return 'ssd';
}

export function driveShortName(disk: PhysicalDisk): string {
  if (disk.name) return disk.name;
  return disk.device.replace(/^\/dev\//, '');
}
