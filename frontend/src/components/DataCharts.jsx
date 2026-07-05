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

/**
 * BOLT: High-performance SVG-based Candlestick chart.
 * Handles OHLC data with zero external dependencies and minimal memory footprint.
 */
export const CandlestickChart = React.memo(({ data = [], width = 100, height = 50, signals = [] }) => {
  if (!Array.isArray(data) || data.length < 2) return <div style={{ width, height }} />;

  const { bars, min, max, range, barWidth, gap } = React.useMemo(() => {
    // SEC: Validate all data points to prevent Infinity/NaN from breaking SVG layout or causing hangs
    const validData = data.filter(d =>
       Number.isFinite(d.low) && Number.isFinite(d.high) &&
       Number.isFinite(d.open) && Number.isFinite(d.close)
    );

    if (validData.length < 2) return { bars: [], min: 0, max: 0, range: 1, barWidth: 0, gap: 0 };

    const min = Math.min(...validData.map(d => d.low));
    const max = Math.max(...validData.map(d => d.high));
    const range = (max - min) || 1;
    const barWidth = (width / data.length) * 0.7;
    const gap = (width / data.length) * 0.3;

    const bars = data.map((d, i) => {
      const x = i * (width / data.length) + gap / 2;
      const yHigh = height - ((d.high - min) / range) * height;
      const yLow = height - ((d.low - min) / range) * height;
      const yOpen = height - ((d.open - min) / range) * height;
      const yClose = height - ((d.close - min) / range) * height;

      return {
        x,
        wickX: x + barWidth / 2,
        yHigh,
        yLow,
        yBodyTop: Math.min(yOpen, yClose),
        bodyHeight: Math.max(Math.abs(yOpen - yClose), 1),
        isUp: d.close >= d.open,
        timestamp: d.time || d.t
      };
    });

    return { bars, min, max, range, barWidth, gap };
  }, [data, width, height]);

  return (
    <svg width={width} height={height} className="overflow-visible select-none">
      {bars.map((bar, i) => {
        const color = bar.isUp ? '#00e5a0' : '#ff4466';
        const hasSignal = signals.some(s => s.time === bar.timestamp);

        return (
          <g key={i}>
            {/* Wick */}
            <line
              x1={bar.wickX}
              y1={bar.yHigh}
              x2={bar.wickX}
              y2={bar.yLow}
              stroke={color}
              strokeWidth="1"
              opacity="0.6"
            />
            {/* Body */}
            <rect
              x={bar.x}
              y={bar.yBodyTop}
              width={barWidth}
              height={bar.bodyHeight}
              fill={bar.isUp ? color : 'transparent'}
              stroke={color}
              strokeWidth="1"
              rx="0.5"
            />
            {/* Signal Highlight */}
            {hasSignal && (
              <circle
                cx={bar.wickX}
                cy={bar.isUp ? bar.yLow + 4 : bar.yHigh - 4}
                r="2"
                className="fill-accent animate-pulse"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
});
