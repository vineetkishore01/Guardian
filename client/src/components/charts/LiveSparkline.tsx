import React, { useId } from 'react';

export interface LiveSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Any CSS colour. Defaults to the brand token so it tracks the theme. */
  color?: string;
  className?: string;
  min?: number;
  max?: number;
  /** Number of trailing samples to draw. */
  window?: number;
}

export function LiveSparkline({
  data,
  width = 72,
  height = 24,
  color = 'hsl(var(--brand))',
  className = '',
  min,
  max,
  window: sampleWindow = 30,
}: LiveSparklineProps) {
  const gradId = useId();

  // Reserve the exact footprint even with no data, so cards do not resize as
  // history arrives. The old placeholder used `w-[${width}px]`, an interpolated
  // class Tailwind cannot see at build time, so it collapsed to zero width.
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden="true" />;
  }

  const values = data.slice(-sampleWindow).filter((v) => Number.isFinite(v));
  if (values.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden="true" />;
  }

  const minVal = min !== undefined ? min : Math.min(...values, 0);
  const maxVal = max !== undefined ? max : Math.max(...values, 1);
  const range = maxVal - minVal || 1;

  const pad = 2;
  const usableHeight = height - pad * 2;

  const points = values.map((val, idx) => {
    const x = (idx / (values.length - 1)) * width;
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    const y = height - pad - ((clamped - minVal) / range) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1].split(',').map(Number);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Trend, latest value ${values[values.length - 1].toFixed(1)}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.24} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Leading-edge dot anchors the eye on the current value. */}
      <circle cx={lastX} cy={lastY} r="1.75" fill={color} />
    </svg>
  );
}
