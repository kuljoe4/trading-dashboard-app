import React, { useId, useMemo, useState, useRef, useEffect } from 'react';
import { fmtUSD, solveSmoothing } from '../lib/theme';
import { cn, Tooltip } from '../components/ui/primitives';

const downsample = (data, threshold = 100) => {
  if (data.length <= threshold) return data;
  const factor = Math.floor(data.length / threshold);
  const result = [];
  for (let i = 0; i < data.length; i += factor) {
    result.push(data[i]);
  }
  // Ensure the last point is always included to show current PnL accurately
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
};

export const EquityCurve = ({ data = [], height = 180, colorDrawdown = false }) => {
  const gradientId = useId().replace(/:/g, '')
  const glowId = `${gradientId}-glow`
  const containerRef = useRef(null);
  const [hoverData, setHoverData] = useState(null);

  const { points, viewMin, viewMax, viewRange } = useMemo(() => {
    const downsampled = downsample(data);
    if (!downsampled || downsampled.length < 2) return { points: [], viewMin: 0, viewMax: 0.1, viewRange: 0.1 };

    const values = downsampled.map(d => d.pnl);
    const min = Math.min(0, ...values);
    const max = Math.max(0.1, ...values);
    const range = max - min;
    const padding = range * 0.15; // Slightly more padding

    const vMin = min - padding;
    const vMax = max + padding;
    const vRange = vMax - vMin;

    const pts = downsampled.map((d, i) => {
      const x = (i / (downsampled.length - 1)) * 100;
      const y = 100 - ((d.pnl - vMin) / vRange) * 100;
      return { x, y, pnl: d.pnl, ts: d.ts };
    });

    return { points: pts, viewMin: vMin, viewMax: vMax, viewRange: vRange };
  }, [data]);

  const pathD = useMemo(() => solveSmoothing(points), [points]);

  const zeroY = useMemo(() => {
    return 100 - ((0 - viewMin) / viewRange) * 100;
  }, [viewMin, viewRange]);

  const areaAboveD = points.length >= 2 ? `${pathD} L 100 ${zeroY} L 0 ${zeroY} Z` : '';
  const areaBelowD = points.length >= 2 ? `${pathD} L 100 ${zeroY} L 0 ${zeroY} Z` : '';

  const handleInteraction = (clientX) => {
    if (!containerRef.current || points.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = ((clientX - rect.left) / rect.width) * 100;

    // Find closest point
    let closest = points[0];
    let minDiff = Math.abs(points[0].x - xPct);

    for (const p of points) {
      const diff = Math.abs(p.x - xPct);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    setHoverData({ ...closest, clientX: clientX, clientY: rect.top + (closest.y * rect.height / 100) });
  };

  const handleMouseMove = (e) => handleInteraction(e.clientX);
  const handleTouchMove = (e) => {
    if (e.touches && e.touches[0]) {
      handleInteraction(e.touches[0].clientX);
    }
  };

  const handleMouseLeave = () => setHoverData(null);

  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-[180px] bg-surface/20 border border-border/40 rounded-2xl border-dashed">
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Insufficient Trade Data</span>
      </div>
    );
  }

  const currentPnl = data[data.length - 1].pnl;

  return (
    <div
      ref={containerRef}
      className="relative group cursor-crosshair select-none touch-none"
      role="img"
      aria-label={`Cumulative profit and loss chart, latest value ${fmtUSD(currentPnl)}.`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchMove}
      onTouchEnd={handleMouseLeave}
    >
      {/* Header Info - Moved above chart plot to prevent overlap */}
      <div className="flex items-start justify-between mb-6 min-h-[64px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Cumulative P&L</span>
          <span className={cn("text-2xl font-bold font-mono tracking-tighter", currentPnl >= 0 ? "text-green" : "text-red")}>
            {fmtUSD(hoverData ? hoverData.pnl : currentPnl)}
          </span>
          <div className="h-4"> {/* Fix CLS by pre-allocating space for date */}
            {hoverData?.ts && (
              <span className="text-[9px] text-dim font-mono uppercase mt-1">
                {new Date(hoverData.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* High/Low Markers - Improved Contrast & Visibility */}
        <div className="flex flex-col items-end gap-1.5 pt-1">
          <div className="flex items-center gap-2">
             <span className="text-[9px] text-dim font-bold uppercase tracking-tight">High</span>
             <span className="text-[11px] text-text font-bold font-mono">{fmtUSD(viewMax)}</span>
          </div>
          <div className="flex items-center gap-2">
             <span className="text-[9px] text-dim font-bold uppercase tracking-tight">Low</span>
             <span className="text-[11px] text-text font-bold font-mono">{fmtUSD(viewMin)}</span>
          </div>
        </div>
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full overflow-visible"
        style={{ height: `${height}px` }}
      >
        <defs>
          <linearGradient id={`${gradientId}-area-above`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-green)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--color-green)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradientId}-area-below`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--color-red)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--color-red)" stopOpacity="0" />
          </linearGradient>

          <clipPath id={`${gradientId}-clip-above`}>
            <rect x="0" y="0" width="100" height={zeroY} />
          </clipPath>
          <clipPath id={`${gradientId}-clip-below`}>
            <rect x="0" y={zeroY} width="100" height={100 - zeroY} />
          </clipPath>

          <filter id={glowId}>
            <feGaussianBlur stdDeviation="0.4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Grid Lines */}
        <line x1="0" y1="25" x2="100" y2="25" stroke="currentColor" className="text-border/5" strokeWidth="0.1" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" className="text-border/5" strokeWidth="0.1" />
        <line x1="0" y1="75" x2="100" y2="75" stroke="currentColor" className="text-border/5" strokeWidth="0.1" />

        {/* Zero Baseline */}
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" className="text-border/20" strokeWidth="0.3" strokeDasharray="1,2" />

        {/* Areas */}
        <path d={areaAboveD} fill={`url(#${gradientId}-area-above)`} clipPath={`url(#${gradientId}-clip-above)`} className="transition-all duration-700" />
        <path d={areaBelowD} fill={`url(#${gradientId}-area-below)`} clipPath={`url(#${gradientId}-clip-below)`} className="transition-all duration-700" />

        {/* Main Line - Positive */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-green)"
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${gradientId}-clip-above)`}
          filter={`url(#${glowId})`}
          className="transition-all duration-700"
        />

        {/* Main Line - Negative */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-red)"
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${gradientId}-clip-below)`}
          filter={`url(#${glowId})`}
          className="transition-all duration-700"
        />

        {/* Interaction Crosshair */}
        {hoverData && (
          <g>
            <line
              x1={hoverData.x} y1="0" x2={hoverData.x} y2="100"
              stroke="var(--color-accent)" strokeWidth="0.2" strokeDasharray="1,2" className="opacity-40"
            />
            <circle
              cx={hoverData.x}
              cy={hoverData.y}
              r="1.2"
              fill="var(--color-accent)"
              filter={`url(#${glowId})`}
              className="animate-pulse"
            />
          </g>
        )}

        {/* Current Value Dot (if not hovering) - Trend Matching Color */}
        {!hoverData && points.length > 0 && (
          <circle
            cx={points[points.length-1].x}
            cy={points[points.length-1].y}
            r="1"
            fill={points[points.length-1].pnl >= 0 ? "var(--color-green)" : "var(--color-red)"}
            filter={`url(#${glowId})`}
          />
        )}
      </svg>
    </div>
  );
};

export const TODPerformance = ({ data = [] }) => {
  const maxPnl = Math.max(1, ...data.map(d => Math.abs(d.pnl)));

  const { avgPos, avgNeg } = useMemo(() => {
    const pos = data.filter(d => d.pnl > 0).map(d => d.pnl);
    const neg = data.filter(d => d.pnl < 0).map(d => Math.abs(d.pnl));
    return {
      avgPos: pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0,
      avgNeg: neg.length ? neg.reduce((a, b) => a + b, 0) / neg.length : 0
    };
  }, [data]);

  const avgPosHeight = (Math.sqrt(avgPos) / Math.sqrt(maxPnl)) * 50;
  const avgNegHeight = (Math.sqrt(avgNeg) / Math.sqrt(maxPnl)) * 50;

  return (
    <div className="space-y-6" role="region" aria-label="Time of day performance histogram">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] md:text-[9px] text-dim font-bold uppercase tracking-widest">Time-of-Day Performance (Local)</span>
        <div className="flex gap-4" aria-hidden="true">
          <div className="flex items-center gap-1.5">
             <div className="w-1.5 h-1.5 rounded-full bg-green" />
             <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Profit</span>
          </div>
          <div className="flex items-center gap-1.5">
             <div className="w-1.5 h-1.5 rounded-full bg-red" />
             <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Loss</span>
          </div>
        </div>
      </div>

      <div className="relative h-[140px] md:h-[120px] flex items-center justify-between gap-0.5">
        {/* Zero baseline */}
        <div className="absolute left-0 right-0 h-px bg-border/40 z-0 top-1/2" />

        {/* Average Lines */}
        {avgPos > 0 && (
          <div
            className="absolute left-0 right-0 border-t border-green/20 z-0 pointer-events-none"
            style={{ bottom: `calc(50% + ${avgPosHeight}%)` }}
          >
            <span className="absolute right-0 -top-3 text-[6px] text-green/40 font-bold uppercase">Avg +</span>
          </div>
        )}
        {avgNeg > 0 && (
          <div
            className="absolute left-0 right-0 border-b border-red/20 z-0 pointer-events-none"
            style={{ top: `calc(50% + ${avgNegHeight}%)` }}
          >
            <span className="absolute right-0 -bottom-3 text-[6px] text-red/40 font-bold uppercase">Avg -</span>
          </div>
        )}

        {data.map((h) => {
          const isPos = h.pnl >= 0;
          const absPnl = Math.abs(h.pnl);
          // Non-linear scaling to ensure small but non-zero values are visible
          // We use square root scaling for the height calculation
          const scaleFactor = Math.sqrt(absPnl) / Math.sqrt(maxPnl);
          const heightPct = absPnl === 0 ? 0 : Math.max(6, scaleFactor * 50);

          return (
            <div key={h.hour} className="flex-1 h-full flex flex-col group relative z-10">
              <div className="flex-1 relative">
                <Tooltip
                  content={
                    <div className="min-w-[80px]">
                      <div className="text-[8px] text-dim font-bold uppercase tracking-widest mb-1">{h.hour}:00</div>
                      <div className={cn("text-[10px] font-mono font-bold", isPos ? "text-green" : "text-red")}>{fmtUSD(h.pnl)}</div>
                      <div className="text-[9px] text-dim font-mono">{Number(h.winRate || 0).toFixed(0)}% WR ({h.wins}/{h.total})</div>
                    </div>
                  }
                  side={isPos ? "top" : "bottom"}
                >
                  <div
                    role="img"
                    aria-label={`${h.hour}:00, ${isPos ? 'positive' : 'negative'} performance, ${fmtUSD(h.pnl)} PnL, ${Number(h.winRate || 0).toFixed(0)}% win rate`}
                    className={cn(
                      "absolute left-0 right-0 transition-all duration-300 hover:opacity-100 opacity-60 cursor-help",
                      isPos
                        ? "bg-green border-t border-green/40 rounded-t-[2px]"
                        : "bg-red border-b border-red/40 rounded-b-[2px]"
                    )}
                    style={{
                      height: `${heightPct}%`,
                      [isPos ? 'bottom' : 'top']: '50%'
                    }}
                  />
                </Tooltip>
              </div>
              <span className="text-[7px] text-dim font-mono font-bold text-center mt-auto py-1 hidden sm:block">{h.hour}</span>
              <span className="text-[7px] text-dim font-mono font-bold text-center mt-auto py-1 block sm:hidden">
                {h.hour % 3 === 0 ? h.hour : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
