import React, { useRef, useState, useEffect } from 'react'
import { C, solveSmoothing } from '../lib/theme'
import { cn } from './ui/utils'
import { formatDuration } from '../lib/formatters'

export const Sparkline = React.memo(({ data = [], width = 60, height = 24, color = "accent" }) => {
  // Performance: Use useMemo for heavy geometry calculations
  const pathD = React.useMemo(() => {
    const safeData = Array.isArray(data) ? data : [];
    if (safeData.length < 2) return "";

    // BOLT: Single-pass O(N) loop to find both min and max with zero intermediate allocations.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < safeData.length; i++) {
      const val = safeData[i];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 1;

    const range = (max - min) || 1;

    const points = safeData.map((val, i) => {
      const x = (i / (safeData.length - 1)) * width;
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
        strokeWidth="0.8"
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
export const CandlestickChart = React.memo(({ data = [], width: initialWidth = 100, height = 50, signals = [], threshold, isLong, entryPrice, showOscillator = true, decisionMarkers = [], slPrice, supertrendLine = null }) => {
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

  const { bars, min, max, range, barWidth, gap, thresholdY, slY, supertrendPoints } = React.useMemo(() => {
    try {
      const safeData = Array.isArray(data) ? data : [];
      if (safeData.length < 2) return { bars: [], min: 0, max: 0, range: 1, barWidth: 0, gap: 0, thresholdY: null, slY: null, supertrendPoints: [] };

      // BOLT OPTIMIZATION: Combine validation and min/max calculation into a single-pass loop
      // avoiding intermediate array allocations (.filter) and repeated iterations.
      const validData = [];
      let dMin = Infinity;
      let dMax = -Infinity;

      for (let i = 0; i < safeData.length; i++) {
        const d = safeData[i];
        if (d && Number.isFinite(d.low) && Number.isFinite(d.high) && Number.isFinite(d.open) && Number.isFinite(d.close)) {
          validData.push(d);
          if (d.low < dMin) dMin = d.low;
          if (d.high > dMax) dMax = d.high;
        }
      }

      const validLen = validData.length;
      if (validLen < 2) return { bars: [], min: 0, max: 0, range: 1, barWidth: 0, gap: 0, thresholdY: null, slY: null, supertrendPoints: [] };

      if (Array.isArray(supertrendLine)) {
        for (let i = 0; i < supertrendLine.length; i++) {
          const val = supertrendLine[i]?.value;
          if (val && val > 0) {
            if (val < dMin) dMin = val;
            if (val > dMax) dMax = val;
          }
        }
      }

      const thresholdPrice = entryPrice ? entryPrice * (1 + (isLong ? threshold : -threshold) / 100) : null;

      if (thresholdPrice !== null) {
        if (thresholdPrice < dMin) dMin = thresholdPrice;
        if (thresholdPrice > dMax) dMax = thresholdPrice;
      }
      if (entryPrice !== null) {
        if (entryPrice < dMin) dMin = entryPrice;
        if (entryPrice > dMax) dMax = entryPrice;
      }
      if (slPrice !== null) {
        if (slPrice < dMin) dMin = slPrice;
        if (slPrice > dMax) dMax = slPrice;
      }

      // Safety fallback for empty/invalid data ranges
      if (dMin === Infinity) dMin = 0;
      if (dMax === -Infinity) dMax = 1;

      const dRange = (dMax - dMin) || 1;
      const bWidth = (width / data.length) * 0.7;
      const bGap = (width / data.length) * 0.3;

      const supertrendPoints = [];
      if (Array.isArray(supertrendLine) && supertrendLine.length === validLen) {
        for (let i = 0; i < validLen; i++) {
          const val = supertrendLine[i]?.value;
          if (val && val > 0) {
            const x = i * (width / validLen) + bGap / 2 + bWidth / 2;
            const y = chartHeight - ((val - dMin) / dRange) * chartHeight;
            supertrendPoints.push({
              x,
              y,
              direction: supertrendLine[i]?.direction || 'up'
            });
          }
        }
      }

      // BOLT OPTIMIZATION: Pre-build signal timestamp set and decision marker map for O(1) bar lookups.
      // This completely eliminates O(N*S) signals.some() and O(N*M) decisionMarkers.find() scans during JSX render.
      const signalSet = new Set();
      if (Array.isArray(signals)) {
        for (let i = 0; i < signals.length; i++) {
          const st = signals[i]?.time;
          if (st) signalSet.add(st);
        }
      }

      const markerIndexMap = new Map();
      const markerTimeMap = new Map();
      if (Array.isArray(decisionMarkers)) {
        for (let i = 0; i < decisionMarkers.length; i++) {
          const m = decisionMarkers[i];
          if (!m) continue;
          if (typeof m.index === 'number') markerIndexMap.set(m.index, m);
          if (m.time) markerTimeMap.set(m.time, m);
        }
      }

      const bars = new Array(validLen);
      for (let i = 0; i < validLen; i++) {
        const d = validData[i];
        const x = i * (width / validLen) + bGap / 2;
        const yHigh = chartHeight - ((d.high - dMin) / dRange) * chartHeight;
        const yLow = chartHeight - ((d.low - dMin) / dRange) * chartHeight;
        const yOpen = chartHeight - ((d.open - dMin) / dRange) * chartHeight;
        const yClose = chartHeight - ((d.close - dMin) / dRange) * chartHeight;

        // Simple momentum oscillator calculation (pct change from 3 bars ago)
        const prevPrice = validData[Math.max(0, i - 3)]?.close || d.open;
        const momentum = ((d.close - prevPrice) / prevPrice) * 100;

        const timestamp = d.time || d.t;
        const hasSignal = signalSet.has(timestamp);
        const marker = markerIndexMap.get(i) || markerTimeMap.get(timestamp);

        bars[i] = {
          x,
          wickX: x + bWidth / 2,
          yHigh,
          yLow,
          yBodyTop: Math.min(yOpen, yClose),
          bodyHeight: Math.max(Math.abs(yOpen - yClose), 1),
          isUp: d.close >= d.open,
          timestamp,
          momentum,
          hasSignal,
          marker
        };
      }

      const thresholdY = thresholdPrice ? chartHeight - ((thresholdPrice - dMin) / dRange) * chartHeight : null;
      const slY = slPrice ? chartHeight - ((slPrice - dMin) / dRange) * chartHeight : null;

      return { bars, min: dMin, max: dMax, range: dRange, barWidth: bWidth, gap: bGap, thresholdY, slY, supertrendPoints };
    } catch (err) {
      console.error('[CandlestickChart] Geometry calculation failed', err);
      return { bars: [], min: 0, max: 0, range: 1, barWidth: 0, gap: 0, thresholdY: null, slY: null, supertrendPoints: [] };
    }
  }, [data, width, chartHeight, threshold, isLong, entryPrice, decisionMarkers, slPrice, supertrendLine, signals]);

  const oscMax = React.useMemo(() => {
    // BOLT: Zero-allocation max calculation for high-frequency oscillator lane
    let m = 0.1;
    for (let i = 0; i < (bars || []).length; i++) {
      const v = Math.abs(bars[i].momentum || 0);
      if (v > m) m = v;
    }
    return m;
  }, [bars]);

  const handleMouseMove = (e) => {
    if (!containerRef.current || !Array.isArray(data) || data.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const barIndex = Math.floor(x / (width / data.length));
    if (barIndex >= 0 && barIndex < (bars || []).length) {
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
      {/* Supertrend Line */}
      {supertrendPoints && supertrendPoints.length > 0 && (
        <g>
          {supertrendPoints.map((pt, i) => {
            if (i === 0) return null;
            const prevPt = supertrendPoints[i - 1];
            const color = pt.direction === 'up' ? '#00e5a0' : '#ff4466';
            return (
              <line
                key={i}
                x1={prevPt.x}
                y1={prevPt.y}
                x2={pt.x}
                y2={pt.y}
                stroke={color}
                strokeWidth="0.8"
                strokeLinecap="round"
                opacity="0.8"
              />
            );
          })}
        </g>
      )}

      {/* SL Line */}
      {slY !== null && (
        <g>
          <line
            x1="0"
            y1={slY}
            x2={width}
            y2={slY}
            stroke="#ff4466"
            strokeWidth="0.8"
            strokeDasharray="2 2"
            opacity="0.6"
          />
          <text
            x={width + 4}
            y={slY}
            className="fill-red text-[8px] font-black font-mono"
            alignmentBaseline="middle"
          >
            SL
          </text>
        </g>
      )}

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
        {(bars || []).map((bar, i) => {
          const color = bar.isUp ? '#00e5a0' : '#ff4466';
          const hasSignal = bar.hasSignal;
          const marker = bar.marker;

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
              {/* Decision / Signal Highlight */}
              {marker && (
                <g>
                  <rect
                    x={bar.x - 2}
                    y={-6}
                    width={barWidth + 4}
                    height={chartHeight + 12}
                    fill={marker.color || '#5b6fff'}
                    opacity="0.08"
                    rx="4"
                  />
                  <text
                    x={bar.wickX}
                    y={bar.isUp ? Math.max(8, bar.yHigh - 8) : Math.min(chartHeight - 2, bar.yLow + 10)}
                    textAnchor="middle"
                    className="fill-white text-[8px] font-black uppercase"
                  >
                    {marker.label}
                  </text>
                </g>
              )}
              {hasSignal && (
                <circle
                  cx={bar.wickX}
                  cy={bar.isUp ? bar.yLow + 4 : bar.yHigh - 4}
                  r="2"
                  className="fill-accent animate-pulse"
                 vectorEffect="non-scaling-stroke" />
              )}
            </g>
          );
        })}
      </g>

      {/* Oscillator Lane */}
      {showOscillator && (
        <g transform={`translate(0, ${chartHeight + gapBetween})`}>
          <line x1="0" y1={oscillatorHeight / 2} x2={width} y2={oscillatorHeight / 2} stroke="currentColor" opacity="0.1" strokeWidth="1" />
          {(bars || []).map((bar, i) => {
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
        {[0, Math.floor((bars || []).length / 2), (bars || []).length - 1].map((idx) => {
          const bar = (bars || [])[idx];
          if (!bar) return null;
          const age = Date.now() - (bar.timestamp || Date.now());
          return (
            <text
              key={`label-${idx}`}
              x={bar.wickX}
              y={12}
              className="fill-dim text-[8px] font-bold font-mono uppercase"
              textAnchor={idx === 0 ? "start" : idx === (bars || []).length - 1 ? "end" : "middle"}
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
