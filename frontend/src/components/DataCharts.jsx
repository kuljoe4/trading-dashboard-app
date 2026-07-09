import React, { useRef, useState, useEffect } from 'react'
import { C, solveSmoothing } from '../lib/theme'
import { cn } from './ui/utils'
import { formatDuration } from '../lib/formatters'

export const Sparkline = React.memo(({ data = [], width = 60, height = 24, color = "accent" }) => {
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

  if (!data || data.length < 2) return <div style={{ width, height }} />;

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
export const CandlestickChart = React.memo(({ data = [], width: initialWidth = 100, height = 50, signals = [], threshold, isLong, entryPrice, showOscillator = true }) => {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(initialWidth);
  const [hoverData, setHoverData] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const chartHeight = showOscillator ? height * 0.7 : height;
  const oscillatorHeight = showOscillator ? height * 0.2 : 0;
  const gapBetween = showOscillator ? height * 0.1 : 0;

  const { bars, min, max, range, barWidth, gap, thresholdY } = React.useMemo(() => {
    if (!Array.isArray(data) || data.length < 2) return { bars: [], min: 0, max: 0, range: 1, barWidth: 0, gap: 0, thresholdY: null };
    // SEC: Validate all data points to prevent Infinity/NaN from breaking SVG layout or causing hangs
    const validData = data.filter(d =>
       Number.isFinite(d.low) && Number.isFinite(d.high) &&
       Number.isFinite(d.open) && Number.isFinite(d.close)
    );

    if (validData.length < 2) return { bars: [], min: 0, max: 0, range: 1, barWidth: 0, gap: 0 };

    const thresholdPrice = entryPrice ? entryPrice * (1 + (isLong ? threshold : -threshold) / 100) : null;
    const prices = validData.flatMap(d => [d.low, d.high]);
    if (thresholdPrice) prices.push(thresholdPrice);
    if (entryPrice) prices.push(entryPrice);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = (max - min) || 1;
    const barWidth = (width / data.length) * 0.7;
    const gap = (width / data.length) * 0.3;

    const bars = data.map((d, i) => {
      const x = i * (width / data.length) + gap / 2;
      const yHigh = chartHeight - ((d.high - min) / range) * chartHeight;
      const yLow = chartHeight - ((d.low - min) / range) * chartHeight;
      const yOpen = chartHeight - ((d.open - min) / range) * chartHeight;
      const yClose = chartHeight - ((d.close - min) / range) * chartHeight;

      // Simple momentum oscillator calculation (pct change from 3 bars ago)
      const prevPrice = data[Math.max(0, i - 3)]?.close || d.open;
      const momentum = ((d.close - prevPrice) / prevPrice) * 100;

      return {
        x,
        wickX: x + barWidth / 2,
        yHigh,
        yLow,
        yBodyTop: Math.min(yOpen, yClose),
        bodyHeight: Math.max(Math.abs(yOpen - yClose), 1),
        isUp: d.close >= d.open,
        timestamp: d.time || d.t,
        momentum
      };
    });

    const thresholdY = thresholdPrice ? chartHeight - ((thresholdPrice - min) / range) * chartHeight : null;

    return { bars, min, max, range, barWidth, gap, thresholdY };
  }, [data, width, chartHeight, threshold, isLong, entryPrice]);

  const oscMax = useMemo(() => Math.max(...bars.map(b => Math.abs(b.momentum || 0)), 0.1), [bars]);

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const barIndex = Math.floor(x / (width / data.length));
    if (barIndex >= 0 && barIndex < bars.length) {
      setHoverData({ ...bars[barIndex], original: data[barIndex], mouseX: x });
    }
  };

  const handleMouseLeave = () => setHoverData(null);

  if (!Array.isArray(data) || data.length < 2) return <div ref={containerRef} style={{ width: '100%', height }} />;

  return (
    <div
      ref={containerRef}
      className="w-full relative group/chart"
      style={{ height }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
    <svg width={width} height={height} className="overflow-visible select-none">
      {/* Threshold Line */}
      {thresholdY !== null && (
        <g>
          <line
            x1="0"
            y1={thresholdY}
            x2={width}
            y2={thresholdY}
            stroke="#f5a623"
            strokeWidth="1"
            strokeDasharray="4 2"
            opacity="0.4"
          />
          <text
            x={width + 4}
            y={thresholdY}
            className="fill-amber text-[8px] font-bold font-mono"
            alignmentBaseline="middle"
          >
            {threshold}%
          </text>
        </g>
      )}

      {/* Main Chart */}
      <g>
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
      </g>

      {/* Oscillator Lane */}
      {showOscillator && (
        <g transform={`translate(0, ${chartHeight + gapBetween})`}>
          <line x1="0" y1={oscillatorHeight / 2} x2={width} y2={oscillatorHeight / 2} stroke="currentColor" opacity="0.1" strokeWidth="1" />
          {bars.map((bar, i) => {
            const h = (Math.abs(bar.momentum) / oscMax) * (oscillatorHeight / 2);
            const isPos = bar.momentum >= 0;
            return (
              <rect
                key={`osc-${i}`}
                x={bar.x}
                y={isPos ? (oscillatorHeight / 2) - h : oscillatorHeight / 2}
                width={barWidth}
                height={Math.max(h, 1)}
                fill={isPos ? '#00e5a0' : '#ff4466'}
                opacity="0.6"
              />
            )
          })}
        </g>
      )}

      {/* X-Axis Labels (Relative Time) */}
      <g transform={`translate(0, ${height})`}>
        {[0, Math.floor(bars.length / 2), bars.length - 1].map((idx) => {
          const bar = bars[idx];
          if (!bar) return null;
          const age = Date.now() - (bar.timestamp || Date.now());
          return (
            <text
              key={`label-${idx}`}
              x={bar.wickX}
              y={12}
              className="fill-dim text-[8px] font-bold font-mono uppercase"
              textAnchor={idx === 0 ? "start" : idx === bars.length - 1 ? "end" : "middle"}
            >
              {formatDuration(age)} ago
            </text>
          );
        })}
      </g>

      {/* Crosshair */}
      {hoverData && (
        <line
          x1={hoverData.mouseX}
          y1="0"
          x2={hoverData.mouseX}
          y2={height}
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          opacity="0.3"
        />
      )}
    </svg>

    {/* Scrub Tooltip */}
    {hoverData && (
      <div
        className="absolute z-50 bg-surface/95 border border-border p-2 rounded shadow-xl pointer-events-none flex flex-col gap-1 min-w-[80px]"
        style={{
          left: Math.min(width - 90, Math.max(10, hoverData.mouseX - 40)),
          top: -45
        }}
      >
        <div className="flex justify-between items-center gap-2">
           <span className="text-[8px] text-dim font-black uppercase">Price</span>
           <span className="text-[10px] font-mono font-bold">${hoverData.original.close.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center gap-2">
           <span className="text-[8px] text-dim font-black uppercase">Mom</span>
           <span className={cn("text-[10px] font-mono font-bold", hoverData.momentum >= 0 ? "text-green" : "text-red")}>
             {Number(hoverData.momentum || 0).toFixed(2)}%
           </span>
        </div>
      </div>
    )}
    </div>
  );
});
