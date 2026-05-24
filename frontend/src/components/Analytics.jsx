import React, { useId, useMemo, useState, useRef, useEffect } from 'react';
import { fmtUSD, solveSmoothing } from '../lib/theme';
import { cn } from '../components/ui/primitives';

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

  const handleMouseMove = (e) => {
    if (!containerRef.current || points.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;

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

    setHoverData({ ...closest, clientX: e.clientX, clientY: rect.top + (closest.y * rect.height / 100) });
  };

  const handleMouseLeave = () => setHoverData(null);

  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-[180px] bg-surface/20 border border-border/40 rounded-2xl border-dashed">
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Insufficient Trade Data</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative group cursor-crosshair select-none"
      role="img"
      aria-label={`Cumulative profit and loss chart, latest value ${fmtUSD(data[data.length-1].pnl)}.`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="absolute top-2 left-2 flex flex-col gap-0.5 z-10 pointer-events-none">
        <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Cumulative P&L</span>
        <span className={cn("text-lg font-bold font-mono tracking-tighter", data[data.length-1].pnl >= 0 ? "text-green" : "text-red")}>
          {fmtUSD(hoverData ? hoverData.pnl : data[data.length-1].pnl)}
        </span>
        {hoverData?.ts && (
          <span className="text-[8px] text-dim font-mono uppercase">
            {new Date(hoverData.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      <div className="absolute top-2 right-2 flex flex-col items-end gap-1 z-10 pointer-events-none opacity-40">
        <span className="text-[8px] text-dim font-mono">{fmtUSD(viewMax)}</span>
        <div className="h-20" />
        <span className="text-[8px] text-dim font-mono">{fmtUSD(viewMin)}</span>
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full overflow-visible"
        style={{ height: `${height}px` }}
      >
        <defs>
          <linearGradient id={`${gradientId}-area-above`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradientId}-area-below`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0" />
          </linearGradient>

          <clipPath id={`${gradientId}-clip-above`}>
            <rect x="0" y="0" width="100" height={zeroY} />
          </clipPath>
          <clipPath id={`${gradientId}-clip-below`}>
            <rect x="0" y={zeroY} width="100" height={100 - zeroY} />
          </clipPath>

          <filter id={glowId}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Grid Lines */}
        <line x1="0" y1="25" x2="100" y2="25" stroke="currentColor" className="text-border/20" strokeWidth="0.15" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" className="text-border/20" strokeWidth="0.15" />
        <line x1="0" y1="75" x2="100" y2="75" stroke="currentColor" className="text-border/20" strokeWidth="0.15" />

        {/* Zero Baseline */}
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" className="text-border/60" strokeWidth="0.5" strokeDasharray="1,2" />

        {/* Areas */}
        <path d={areaAboveD} fill={`url(#${gradientId}-area-above)`} clipPath={`url(#${gradientId}-clip-above)`} className="transition-all duration-700" />
        <path d={areaBelowD} fill={`url(#${gradientId}-area-below)`} clipPath={`url(#${gradientId}-clip-below)`} className="transition-all duration-700" />

        {/* Main Line - Positive */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--green)"
          strokeWidth="2.5"
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
          stroke="var(--red)"
          strokeWidth="2.5"
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
              stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2,2" className="opacity-50"
            />
            <circle
              cx={hoverData.x}
              cy={hoverData.y}
              r="2.5"
              fill="var(--accent)"
              filter={`url(#${glowId})`}
              className="animate-pulse"
            />
          </g>
        )}

        {/* Current Value Dot (if not hovering) */}
        {!hoverData && points.length > 0 && (
          <circle
            cx={points[points.length-1].x}
            cy={points[points.length-1].y}
            r="2"
            fill="var(--accent)"
            filter={`url(#${glowId})`}
          />
        )}
      </svg>
    </div>
  );
};

export const TODPerformance = ({ data = [] }) => {
  const maxPnl = Math.max(1, ...data.map(d => Math.abs(d.pnl)));

  return (
    <div className="space-y-4" role="region" aria-label="Time of day performance histogram">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Time-of-Day Performance</span>
        <div className="flex gap-4" aria-hidden="true">
          <div className="flex items-center gap-1.5">
             <div className="w-1.5 h-1.5 rounded-full bg-green" />
             <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Win</span>
          </div>
          <div className="flex items-center gap-1.5">
             <div className="w-1.5 h-1.5 rounded-full bg-red" />
             <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Loss</span>
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-1 h-[100px]">
        {data.map((h) => {
          const height = (Math.abs(h.pnl) / maxPnl) * 100;
          return (
            <div key={h.hour} className="flex-1 flex flex-col items-center gap-1.5 group relative">
              <div
                role="img"
                aria-label={`${h.hour}:00 hour, ${h.pnl >= 0 ? 'positive' : 'negative'} performance, ${fmtUSD(h.pnl)} PnL, ${h.winRate.toFixed(0)}% win rate over ${h.total} trades`}
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300 hover:opacity-80",
                  h.pnl >= 0 ? "bg-green/40 border-t border-green/60" : "bg-red/40 border-t border-red/60"
                )}
                style={{ height: `${Math.max(4, height)}%` }}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-surface border border-border p-2 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none min-w-[80px]" aria-hidden="true">
                   <div className="text-[8px] text-dim font-bold uppercase tracking-widest mb-1">{h.hour}:00</div>
                   <div className={cn("text-[10px] font-mono font-bold", h.pnl >= 0 ? "text-green" : "text-red")}>{fmtUSD(h.pnl)}</div>
                   <div className="text-[9px] text-dim font-mono">{h.winRate.toFixed(0)}% WR ({h.wins}/{h.total})</div>
                </div>
              </div>
              <span className="text-[8px] text-dim font-mono font-bold">{h.hour}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
