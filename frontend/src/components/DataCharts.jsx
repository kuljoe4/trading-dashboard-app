import React from 'react'
import { C, solveSmoothing } from '../lib/theme'

export const Sparkline = React.memo(({ data = [], width = 60, height = 24, color = "accent" }) => {
  if (!data || data.length < 2) return <div style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = (max - min) || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return { x, y };
  });

  const pathD = solveSmoothing(points);
  const colorHex = color === 'green' ? '#00e5a0' : color === 'red' ? '#ff4466' : '#5b6fff'

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        fill="none"
        stroke={colorHex}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d={pathD}
      />
    </svg>
  );
})
