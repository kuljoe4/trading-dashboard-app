import React from 'react'
import { C, solveSmoothing } from '../lib/theme'

export const Sparkline = React.memo(({ data = [], width = 60, height = 24, color = "accent" }) => {
  if (!data || data.length < 2) return <div style={{ width, height }} />;

  // Performance: Use useMemo for heavy geometry calculations
  const pathD = React.useMemo(() => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = (max - min) || 1;

    const points = data.map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return { x, y };
    });

    return solveSmoothing(points);
  }, [data, width, height]);

  const colorHex = React.useMemo(() =>
    color === 'green' ? '#00e5a0' : color === 'red' ? '#ff4466' : '#5b6fff',
  [color]);

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
