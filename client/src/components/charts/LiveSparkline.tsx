import React, { useId } from 'react';

export interface LiveSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
  min?: number;
  max?: number;
}

export function LiveSparkline({
  data,
  width = 120,
  height = 32,
  color = '#7dd3fc', // Pastel Sky
  fillOpacity = 0.18,
  className = '',
  min,
  max,
}: LiveSparklineProps) {
  const gradId = useId();

  if (!data || data.length < 2) {
    return <div className={`w-[${width}px] h-[${height}px] opacity-20`} />;
  }

  const values = data.slice(-30);
  const minVal = min !== undefined ? min : Math.min(...values, 0);
  const maxVal = max !== undefined ? max : Math.max(...values, 100);
  const range = maxVal - minVal || 1;

  const points = values.map((val, idx) => {
    const x = (idx / (values.length - 1)) * width;
    const y = height - ((val - minVal) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible ${className}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity * 2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
