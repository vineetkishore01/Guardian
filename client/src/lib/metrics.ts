import { MetricKey, HistoryRange } from '../types/dashboard';
import { formatRate, severityFor, type Severity } from './utils';

/**
 * One description per metric, shared by the dashboard tiles and the detail
 * page, so a metric's name, units, thresholds and axis behaviour cannot drift
 * apart between the two views.
 */
export interface MetricDefinition {
  key: MetricKey;
  label: string;
  description: string;
  unit: string;
  /** Fixed y-axis bounds where the scale is inherently bounded (percentages). */
  yMin?: number;
  yMax?: number;
  warnAt?: number;
  critAt?: number;
  format: (v: number) => string;
  /** Compact form for axis ticks. */
  formatAxis: (v: number) => string;
}

const percent = (v: number) => `${Math.round(v * 10) / 10}%`;
const percentAxis = (v: number) => `${Math.round(v)}%`;

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  cpu: {
    key: 'cpu',
    label: 'CPU utilisation',
    description: 'Share of total processor capacity in use across all threads.',
    unit: '%',
    yMin: 0,
    yMax: 100,
    warnAt: 75,
    critAt: 90,
    format: percent,
    formatAxis: percentAxis,
  },
  ram: {
    key: 'ram',
    label: 'Memory usage',
    description: 'Physical memory in use, excluding reclaimable cache.',
    unit: '%',
    yMin: 0,
    yMax: 100,
    warnAt: 80,
    critAt: 92,
    format: percent,
    formatAxis: percentAxis,
  },
  swap: {
    key: 'swap',
    label: 'Swap usage',
    description: 'Swap space in use. Sustained growth means memory pressure.',
    unit: '%',
    yMin: 0,
    yMax: 100,
    warnAt: 40,
    critAt: 70,
    format: percent,
    formatAxis: percentAxis,
  },
  temp: {
    key: 'temp',
    label: 'Temperature',
    description: 'Primary package sensor reading.',
    unit: '°C',
    yMin: 20,
    warnAt: 75,
    critAt: 85,
    format: (v) => `${Math.round(v * 10) / 10}°C`,
    formatAxis: (v) => `${Math.round(v)}°`,
  },
  netRx: {
    key: 'netRx',
    label: 'Network received',
    description: 'Inbound throughput on the primary interface.',
    unit: '/s',
    yMin: 0,
    format: formatRate,
    formatAxis: formatRate,
  },
  netTx: {
    key: 'netTx',
    label: 'Network transmitted',
    description: 'Outbound throughput on the primary interface.',
    unit: '/s',
    yMin: 0,
    format: formatRate,
    formatAxis: formatRate,
  },
  disk: {
    key: 'disk',
    label: 'Disk usage',
    description: 'Capacity used on the fullest mounted filesystem.',
    unit: '%',
    yMin: 0,
    yMax: 100,
    warnAt: 80,
    critAt: 90,
    format: percent,
    formatAxis: percentAxis,
  },
};

export function isMetricKey(value: string): value is MetricKey {
  return value in METRIC_DEFINITIONS;
}

export function severityForMetric(def: MetricDefinition, value: number): Severity {
  if (def.warnAt === undefined || def.critAt === undefined) return 'ok';
  return severityFor(value, def.warnAt, def.critAt);
}

export const HISTORY_RANGES: Array<{ id: HistoryRange; label: string; title: string }> = [
  { id: '1h', label: '1H', title: 'Last hour, full resolution' },
  { id: '6h', label: '6H', title: 'Last 6 hours, full resolution' },
  { id: '24h', label: '24H', title: 'Last 24 hours, 5-minute averages' },
  { id: '7d', label: '7D', title: 'Last 7 days, 5-minute averages' },
  { id: '30d', label: '30D', title: 'Last 30 days, hourly averages' },
];

export const RESOLUTION_LABEL: Record<string, string> = {
  fine: 'per sample',
  medium: '5-minute averages',
  coarse: 'hourly averages',
};
