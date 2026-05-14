import React, { useMemo } from 'react';
import { fmtUSD } from '../lib/theme';
import { cn } from '../components/ui/primitives';

export const EquityCurve = ({ data = [], height = 180 }) => {
  const points = useMemo(() => {
    if (!data || data.length < 2) return [];

    const values = data.map(d => d.pnl);
    const min = Math.min(0, ...values);
    const max = Math.max(0.1, ...values);
    const range = max - min;
    const padding = range * 0.1;

    const viewMin = min - padding;
    const viewMax = max + padding;
    const viewRange = viewMax - viewMin;

    return data.map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((d.pnl - viewMin) / viewRange) * 100;
      return { x, y, pnl: d.pnl };
    });
  }, [data]);

  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-[180px] bg-surface/20 border border-border/40 rounded-2xl border-dashed">
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Insufficient Trade Data</span>
      </div>
    );
  }

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L 100 100 L 0 100 Z`;

  return (
    <div className="relative group">
      <div className="absolute top-2 left-2 flex flex-col gap-0.5 z-10 pointer-events-none">
        <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Equity Curve (Live)</span>
        <span className={cn("text-lg font-bold font-mono tracking-tighter", data[data.length-1].pnl >= 0 ? "text-green" : "text-red")}>
          {fmtUSD(data[data.length-1].pnl)}
        </span>
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full overflow-visible"
        style={{ height: `${height}px` }}
      >
        <defs>
          <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Baseline (0 PnL) */}
        {(() => {
           const values = data.map(d => d.pnl);
           const min = Math.min(0, ...values);
           const max = Math.max(0.1, ...values);
           const padding = (max - min) * 0.1;
           const viewMin = min - padding;
           const viewMax = max + padding;
           const zeroY = 100 - ((0 - viewMin) / (viewMax - viewMin)) * 100;
           return <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" className="text-border" strokeWidth="0.5" strokeDasharray="2,2" />;
        })()}

        <path d={areaD} fill="url(#curveGradient)" />
        <path
          d={pathD}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow)"
          className="transition-all duration-500"
        />

        {/* Current Value Dot */}
        <circle
          cx={points[points.length-1].x}
          cy={points[points.length-1].y}
          r="2"
          fill="var(--accent)"
          filter="url(#glow)"
        />
      </svg>
    </div>
  );
};

export const TODPerformance = ({ data = [] }) => {
  const maxPnl = Math.max(1, ...data.map(d => Math.abs(d.pnl)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Time-of-Day Performance</span>
        <div className="flex gap-4">
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
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300 hover:opacity-80 cursor-help",
                  h.pnl >= 0 ? "bg-green/40 border-t border-green/60" : "bg-red/40 border-t border-red/60"
                )}
                style={{ height: `${Math.max(4, height)}%` }}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-surface border border-border p-2 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none min-w-[80px]">
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
