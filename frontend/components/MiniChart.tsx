import React from 'react';

// Mock price data points — will be replaced with real data later
const DATA = [40, 55, 38, 62, 45, 70, 58, 80, 65, 88, 75, 95];

interface MiniChartProps {
  width?: number;
  height?: number;
  color?: string;
}

export const MiniChart: React.FC<MiniChartProps> = ({
  width = 140,
  height = 48,
  color = '#00FF7F',
}) => {
  const padding = 4;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const min = Math.min(...DATA);
  const max = Math.max(...DATA);
  const range = max - min || 1;

  // Build SVG polyline points
  const points = DATA.map((v, i) => {
    const x = padding + (i / (DATA.length - 1)) * w;
    const y = padding + h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  // Last point for the dot
  const lastX = padding + w;
  const lastY = padding + h - ((DATA[DATA.length - 1] - min) / range) * h;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Glow filter */}
      <defs>
        <filter id="lineGlow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <polygon
        points={`${padding},${padding + h} ${points} ${lastX},${padding + h}`}
        fill="url(#fillGrad)"
      />

      {/* Line */}
      <polyline
        points={points}
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#lineGlow)"
      />

      {/* End dot */}
      <circle cx={lastX} cy={lastY} r="3.5" fill={color} filter="url(#lineGlow)" />
      <circle cx={lastX} cy={lastY} r="6" fill={color} opacity="0.2" />
    </svg>
  );
};

export default MiniChart;
