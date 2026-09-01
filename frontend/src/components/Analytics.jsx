import React, { useId, useMemo, useState, useRef, useEffect } from 'react';
import { fmtUSD, solveSmoothing } from '../lib/theme';
import { cn, Tooltip } from '../components/ui/primitives';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

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

export const EquityCurve = ({ data = [], height = 180, colorDrawdown = false, hideAxes = false }) => {
  const gradientId = useId().replace(/:/g, '')
  const glowId = `${gradientId}-glow`
  const containerRef = useRef(null);
  const [hoverData, setHoverData] = useState(null);

  const { points, viewMin, viewMax, viewRange } = useMemo(() => {
    const safeData = Array.isArray(data) ? data : [];
    const downsampled = downsample(safeData).filter(d => d && typeof d.pnl === 'number');
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

  const peaks = useMemo(() => {
    if (points.length < 2) return [];
    let currentMax = -Infinity;
    return points.map(p => {
        // Remember Y is inverted, so max PnL is MIN Y
        if (currentMax === -Infinity || p.y < currentMax) {
            currentMax = p.y;
        }
        return { x: p.x, y: currentMax };
    });
  }, [points]);

  const peakPathD = useMemo(() => {
    if (peaks.length < 2) return '';
    let d = `M ${peaks[0].x} ${peaks[0].y}`;
    for (let i = 1; i < peaks.length; i++) {
        d += ` L ${peaks[i].x} ${peaks[i].y}`;
    }
    return d;
  }, [peaks]);

  const drawdownPathD = useMemo(() => {
    if (points.length < 2 || peaks.length < 2) return '';
    // Combine peak path and equity path to form a closed area for shading
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`;
    }
    for (let i = peaks.length - 1; i >= 0; i--) {
        d += ` L ${peaks[i].x} ${peaks[i].y}`;
    }
    d += ' Z';
    return d;
  }, [points, peaks]);

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

  const safeData = Array.isArray(data) ? data : [];
  const currentPnl = safeData[safeData.length - 1]?.pnl ?? 0;

  if (safeData.length < 2) {
    return (
      <div className={cn("flex flex-col items-center justify-center bg-surface/20 border border-border/40 rounded-2xl border-dashed", hideAxes ? "h-full" : "h-[180px]")}>
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Insufficient Trade Data</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative group cursor-crosshair select-none touch-none w-full h-full"
      role="img"
      aria-label={`Cumulative profit and loss chart, latest value ${fmtUSD(currentPnl)}.`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchMove}
      onTouchEnd={handleMouseLeave}
    >
      {/* Header Info - Moved above chart plot to prevent overlap */}
      {!hideAxes && (
        <div className="flex items-start justify-between mb-6 min-h-[64px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Cumulative P&L</span>
            <span className={cn("text-2xl font-bold font-mono tracking-tighter", currentPnl >= 0 ? "text-green" : "text-red")}>
              {fmtUSD(hoverData ? hoverData.pnl : currentPnl)}
            </span>
            <div className="h-4"> {/* Fix CLS by pre-allocating space for date */}
              {hoverData?.ts && (
                <span className="text-[9px] text-dim font-mono uppercase mt-1">
                  {new Date(hoverData.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
      )}

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={cn("w-full overflow-visible", hideAxes ? "mt-0" : "mt-2")}
        style={{ height: hideAxes ? '100%' : `${height}px` }}
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
        {!hideAxes && (
          <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" className="text-border/20" strokeWidth="0.3" strokeDasharray="1,2" />
        )}

        {/* Drawdown Shading */}
        <path d={drawdownPathD} fill="var(--color-red)" fillOpacity="0.05" />

        {/* Peak Watermark */}
        {!hideAxes && (
           <path d={peakPathD} fill="none" stroke="var(--color-accent)" strokeWidth="0.1" strokeDasharray="1,2" opacity="0.2" />
        )}

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

export const StrategyCalendarPnL = ({ trades = [], strategyFilter = 'ALL', sessionFilter = 'ALL' }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const handlePrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Filter trades by strategy and session
  const filteredTrades = useMemo(() => {
    if (!Array.isArray(trades)) return [];
    return trades.filter((t) => {
      if (!t || t.status === 'OPEN' || !t.exit_ts) return false;
      if (sessionFilter !== 'ALL' && t.sessionId !== sessionFilter) return false;
      if (strategyFilter !== 'ALL') {
        const label = t.strategy_label || 'Momentum Strategy';
        if (label !== strategyFilter) return false;
      }
      return true;
    });
  }, [trades, strategyFilter, sessionFilter]);

  // Aggregate daily stats: Map key 'YYYY-MM-DD' => { pnl, wins, losses, count }
  const dailyStatsMap = useMemo(() => {
    const map = new Map();
    const len = filteredTrades.length;
    for (let i = 0; i < len; i++) {
      const t = filteredTrades[i];
      const d = new Date(t.exit_ts);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      let entry = map.get(key);
      if (!entry) {
        entry = { pnl: 0, wins: 0, losses: 0, count: 0 };
        map.set(key, entry);
      }
      const pnl = Number(t.pnl || 0);
      entry.pnl += pnl;
      entry.count += 1;
      if (pnl > 0) entry.wins += 1;
      else if (pnl < 0) entry.losses += 1;
    }
    return map;
  }, [filteredTrades]);

  // Calendar Grid metadata
  const { daysInMonth, startDayOfWeek, monthLabel, year, mNum } = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);

    return {
      daysInMonth: lastDay.getDate(),
      startDayOfWeek: firstDay.getDay(),
      monthLabel: currentDate.toLocaleString('default', { month: 'long' }),
      year: y,
      mNum: m + 1
    };
  }, [currentDate]);

  // Monthly aggregated totals
  const monthlySummary = useMemo(() => {
    let monthlyPnl = 0;
    let monthlyWins = 0;
    let monthlyTrades = 0;

    dailyStatsMap.forEach((stats, key) => {
      const [yStr, mStr] = key.split('-');
      if (Number(yStr) === year && Number(mStr) === mNum) {
        monthlyPnl += stats.pnl;
        monthlyWins += stats.wins;
        monthlyTrades += stats.count;
      }
    });

    const winRate = monthlyTrades > 0 ? (monthlyWins / monthlyTrades) * 100 : 0;
    return { monthlyPnl, monthlyWins, monthlyTrades, winRate };
  }, [dailyStatsMap, year, mNum]);

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-4 bg-surface/30 border border-border/50 rounded-2xl p-4 sm:p-6" role="region" aria-label="Strategy calendar profit and loss breakdown">
      {/* Header controls & monthly totals */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
            <CalendarIcon size={16} />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-black text-text uppercase tracking-tight">{monthLabel} {year}</span>
              <span className="text-[10px] text-dim font-bold uppercase tracking-widest font-mono">({monthlySummary.monthlyTrades} Trades)</span>
            </div>
            <p className="text-[9.5px] text-dim/80 font-medium">Daily PnL breakdown filtered by strategy & session</p>
          </div>
        </div>

        <div className="flex items-center gap-4 self-end sm:self-auto">
          <div className="flex flex-col items-end">
            <span className="text-[8px] text-dim font-black uppercase tracking-widest">Monthly P&L</span>
            <span className={cn("text-base font-black font-mono tracking-tight", monthlySummary.monthlyPnl >= 0 ? "text-green" : "text-red")}>
              {fmtUSD(monthlySummary.monthlyPnl)}
            </span>
          </div>
          <div className="flex flex-col items-end pl-3 border-l border-border/30">
            <span className="text-[8px] text-dim font-black uppercase tracking-widest">Win Rate</span>
            <span className="text-sm font-bold font-mono text-text">
              {monthlySummary.winRate.toFixed(0)}%
            </span>
          </div>

          <div className="flex items-center gap-1 bg-background/50 border border-border/40 p-1 rounded-xl ml-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous Month"
              className="p-1.5 hover:bg-surface text-dim hover:text-text rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next Month"
              className="p-1.5 hover:bg-surface text-dim hover:text-text rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {daysOfWeek.map((day) => (
          <div key={day} className="text-center text-[9px] text-dim font-black uppercase tracking-wider py-1">
            {day}
          </div>
        ))}

        {/* Empty cells before month start */}
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-16 sm:h-20 rounded-xl bg-surface/10 border border-border/10 opacity-30" />
        ))}

        {/* Days of month */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1;
          const key = `${year}-${String(mNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
          const stats = dailyStatsMap.get(key);
          const hasTrades = stats && stats.count > 0;
          const isProfitable = hasTrades && stats.pnl >= 0;

          const tooltipContent = hasTrades
            ? `${key}: PnL ${fmtUSD(stats.pnl)}, ${stats.wins}W / ${stats.losses}L (${stats.count} total trades)`
            : `${key}: No trades recorded`;

          return (
            <Tooltip key={key} content={tooltipContent}>
              <div
                tabIndex={0}
                role="region"
                aria-label={tooltipContent}
                className={cn(
                  "h-16 sm:h-20 p-1.5 sm:p-2 rounded-xl border flex flex-col justify-between transition-all relative group cursor-pointer tab-focus-ring",
                  hasTrades
                    ? isProfitable
                      ? "bg-green/10 border-green/30 hover:border-green/60"
                      : "bg-red/10 border-red/30 hover:border-red/60"
                    : "bg-surface/20 border-border/20 hover:border-border/40"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-dim group-hover:text-text">{dayNum}</span>
                  {hasTrades && (
                    <span className="text-[7.5px] font-black uppercase font-mono px-1 py-0.2 rounded bg-background/50 border border-border/20 text-dim">
                      {stats.wins}W {stats.losses}L
                    </span>
                  )}
                </div>

                {hasTrades ? (
                  <div className="flex flex-col items-end">
                    <span className={cn("text-[11px] sm:text-xs font-black font-mono tracking-tight", isProfitable ? "text-green" : "text-red")}>
                      {fmtUSD(stats.pnl)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[8px] text-dim/30 font-mono text-center mb-1">---</span>
                )}
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};

export const RrOptimizationChart = ({ data = [], recommendedRr = 0 }) => {
  const safeData = Array.isArray(data) ? data : [];
  const containerRef = useRef(null);
  const [hoverData, setHoverData] = useState(null);
  const [hoverPos, setHoverDataPos] = useState(null);

  if (safeData.length < 5) return null;

  const maxPF = Math.max(1, ...safeData.map(d => d.profitFactor));
  const minPF = 0;
  const rangePF = maxPF - minPF;

  const pointsPF = useMemo(() => {
    return safeData.map((d, i) => {
      const x = (i / (safeData.length - 1)) * 100;
      const y = 100 - ((d.profitFactor - minPF) / (rangePF || 1)) * 100;
      return { x, y, ...d };
    });
  }, [safeData, rangePF]);

  const pathPF = useMemo(() => solveSmoothing(pointsPF), [pointsPF]);

  const handleInteraction = (clientX) => {
    if (!containerRef.current || !pointsPF.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = ((clientX - rect.left) / rect.width) * 100;

    let closest = pointsPF[0];
    let minDiff = Math.abs(pointsPF[0].x - xPct);

    for (const p of pointsPF) {
      const diff = Math.abs(p.x - xPct);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    setHoverData(closest);
    setHoverDataPos({ x: closest.x, y: closest.y });
  };

  const currentStats = hoverData || safeData.find(d => d.threshold === recommendedRr) || safeData[Math.floor(safeData.length / 2)];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-dim font-bold uppercase tracking-widest text-left">Edge Optimization Curve</span>
          <div className="flex items-baseline gap-3">
            <span className={cn("text-2xl font-black font-mono tracking-tighter", hoverData ? "text-accent" : "text-text")}>
              {Number(currentStats.threshold || 0).toFixed(1)}R
            </span>
            <span className="text-[10px] text-dim font-black uppercase tracking-widest">
              Target Selection
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
           <div className="flex flex-col">
              <span className="text-[8px] text-dim font-black uppercase tracking-widest">Profit Factor</span>
              <span className="text-xs font-black font-mono text-accent">{Number(currentStats.profitFactor || 0).toFixed(2)}</span>
           </div>
           <div className="flex flex-col">
              <span className="text-[8px] text-dim font-black uppercase tracking-widest">Win Rate</span>
              <span className="text-xs font-black font-mono text-text">{Number(currentStats.winRate || 0).toFixed(0)}%</span>
           </div>
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseMove={(e) => handleInteraction(e.clientX)}
        onMouseLeave={() => { setHoverData(null); setHoverDataPos(null); }}
        onTouchMove={(e) => e.touches?.[0] && handleInteraction(e.touches[0].clientX)}
        onTouchEnd={() => { setHoverData(null); setHoverDataPos(null); }}
        className="relative h-[160px] w-full cursor-crosshair select-none touch-none"
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="pf-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid */}
          <line x1="0" y1="25" x2="100" y2="25" stroke="currentColor" className="text-border/5" strokeWidth="0.1" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" className="text-border/5" strokeWidth="0.1" />
          <line x1="0" y1="75" x2="100" y2="75" stroke="currentColor" className="text-border/5" strokeWidth="0.1" />

          {/* Area */}
          <path
            d={`${pathPF} L 100 100 L 0 100 Z`}
            fill="url(#pf-gradient)"
            className="transition-all duration-700"
          />

          {/* PF Line */}
          <path
            d={pathPF}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="0.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-700"
          />

          {/* Vertical line at recommended RR */}
          {!hoverPos && recommendedRr > 0 && (
            <g>
              <line
                x1={((safeData.findIndex(d => d.threshold === recommendedRr) || 0) / (safeData.length - 1)) * 100}
                y1="0"
                x2={((safeData.findIndex(d => d.threshold === recommendedRr) || 0) / (safeData.length - 1)) * 100}
                y2="100"
                stroke="var(--color-accent)"
                strokeWidth="0.4"
                strokeDasharray="2,2"
                className="opacity-40"
              />
              <circle
                cx={((safeData.findIndex(d => d.threshold === recommendedRr) || 0) / (safeData.length - 1)) * 100}
                cy={100 - ((safeData.find(d => d.threshold === recommendedRr)?.profitFactor || 0) / (rangePF || 1)) * 100}
                r="1.5"
                fill="var(--color-accent)"
              />
            </g>
          )}

          {/* Hover Crosshair */}
          {hoverPos && (
            <g>
              <line x1={hoverPos.x} y1="0" x2={hoverPos.x} y2="100" stroke="var(--color-accent)" strokeWidth="0.3" strokeDasharray="1,2" />
              <circle cx={hoverPos.x} cy={hoverPos.y} r="2.5" fill="var(--color-accent)" className="animate-pulse" />
            </g>
          )}
        </svg>

        <div className="absolute inset-x-0 -bottom-6 flex justify-between">
          <span className="text-[8px] text-dim font-mono font-bold">{Number(safeData[0].threshold || 0).toFixed(1)}R</span>
          <div className="h-px flex-1 mx-4 bg-border/10 self-center" />
          <span className="text-[8px] text-dim font-mono font-bold">{Number(safeData[safeData.length - 1].threshold || 0).toFixed(1)}R</span>
        </div>
      </div>
    </div>
  );
};

export const TODPerformance = ({ data = [] }) => {
  const safeData = Array.isArray(data) ? data : [];
  const validData = useMemo(() => safeData.filter(d => d && typeof d.pnl === 'number'), [safeData]);
  const maxPnl = useMemo(() => Math.max(1, ...validData.map(d => Math.abs(d.pnl))), [validData]);
  const [hoverData, setHoverData] = useState(null);
  const [hoverHour, setHoverHour] = useState(null);
  const containerRef = useRef(null);


  const { avgPos, avgNeg } = useMemo(() => {
    const pos = validData.filter(d => d.pnl > 0).map(d => d.pnl);
    const neg = validData.filter(d => d.pnl < 0).map(d => Math.abs(d.pnl));
    return {
      avgPos: pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0,
      avgNeg: neg.length ? neg.reduce((a, b) => a + b, 0) / neg.length : 0
    };
  }, [validData]);

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[140px] md:h-[120px] bg-surface/20 border border-border/40 rounded-2xl border-dashed">
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">No Hourly Data</span>
      </div>
    );
  }

  const avgPosHeight = (Math.sqrt(avgPos) / Math.sqrt(maxPnl)) * 50;
  const avgNegHeight = (Math.sqrt(avgNeg) / Math.sqrt(maxPnl)) * 50;

  const handleInteraction = (clientX) => {
    if (!containerRef.current || !validData.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = (clientX - rect.left) / rect.width;
    const hourIndex = Math.min(Math.floor(xPct * validData.length), validData.length - 1);
    const item = validData[hourIndex];
    
    // Calculate y position for pointer (center of the bar)
    const isPos = item.pnl >= 0;
    const absPnl = Math.abs(item.pnl);
    const scaleFactor = Math.sqrt(absPnl) / Math.sqrt(maxPnl);
    const heightPct = absPnl === 0 ? 0 : Math.max(6, scaleFactor * 50);
    const yPct = isPos ? (50 - heightPct / 2) : (50 + heightPct / 2);

    setHoverHour(item);
    setHoverData({ x: (hourIndex + 0.5) * (100 / validData.length), y: yPct });
  };

  const currentHourStats = hoverHour || validData.find(h => h.hour === new Date().getHours()) || validData[0] || { pnl: 0, hour: 0, winRate: 0, wins: 0, total: 0 };

  return (
    <div className="space-y-6" role="region" aria-label="Time of day performance histogram">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 min-h-[80px] sm:min-h-[64px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Time-of-Day Performance (Local)</span>
          <div className="flex items-baseline gap-3">
             <span className={cn("text-2xl font-bold font-mono tracking-tighter", (currentHourStats?.pnl || 0) >= 0 ? "text-green" : "text-red")}>
                {fmtUSD(currentHourStats?.pnl || 0)}
             </span>
             <span className="text-[11px] text-dim font-mono font-bold uppercase">{(currentHourStats?.hour || 0)}:00</span>
          </div>
          <div className="h-4">
             {currentHourStats && (
               <span className="text-[9px] text-dim font-mono uppercase">
                  {Number(currentHourStats.winRate || 0).toFixed(0)}% Win Rate · {currentHourStats.wins || 0}/{currentHourStats.total || 0} Trades
               </span>
             )}
          </div>
        </div>

        <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 sm:gap-1.5 pt-1">
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

      <div
        ref={containerRef}
        onMouseMove={(e) => handleInteraction(e.clientX)}
        onMouseLeave={() => { setHoverHour(null); setHoverData(null); }}
        onTouchMove={(e) => e.touches?.[0] && handleInteraction(e.touches[0].clientX)}
        onTouchEnd={() => { setHoverHour(null); setHoverData(null); }}
        className="relative h-[140px] md:h-[120px] cursor-crosshair select-none touch-none"
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {hoverData && (
            <g>
              <line
                x1={hoverData.x} y1="0" x2={hoverData.x} y2="100"
                stroke="var(--color-accent)" strokeWidth="0.5" strokeDasharray="1,2" className="opacity-60"
              />
              <circle
                cx={hoverData.x}
                cy={hoverData.y}
                r="3"
                fill="var(--color-accent)"
                className="animate-pulse"
              />
            </g>
          )}
        </svg>

        <div className="absolute inset-x-0 top-0 bottom-6">
          {/* Zero baseline */}
          <div className="absolute left-0 right-0 h-px bg-border/40 z-0 top-1/2 -translate-y-1/2" />

          {/* Average Range Shading */}
          {avgPos > 0 && avgNeg > 0 && (
            <div
              className="absolute left-0 right-0 bg-accent/5 z-0 pointer-events-none"
              style={{
                top: `calc(50% - ${avgPosHeight}%)`,
                bottom: `calc(50% - ${avgNegHeight}%)`
              }}
            />
          )}

          {/* Average Lines */}
          {avgPos > 0 && (
            <div
              className="absolute left-0 right-0 border-t border-green/20 z-0 pointer-events-none"
              style={{ bottom: `calc(50% + ${avgPosHeight}%)` }}
            >
              <span className="absolute right-0 -top-3.5 text-[7px] text-green/50 font-black uppercase tracking-tighter">Avg + {fmtUSD(avgPos)}</span>
            </div>
          )}
          {avgNeg > 0 && (
            <div
              className="absolute left-0 right-0 border-b border-red/20 z-0 pointer-events-none"
              style={{ top: `calc(50% + ${avgNegHeight}%)` }}
            >
              <span className="absolute right-0 -bottom-3.5 text-[7px] text-red/50 font-black uppercase tracking-tighter">Avg - {fmtUSD(avgNeg)}</span>
            </div>
          )}

          <div className="absolute inset-0 flex items-stretch justify-between gap-0.5">
            {validData.map((h) => {
              const isPos = h.pnl >= 0;
              const absPnl = Math.abs(h.pnl);
              const scaleFactor = Math.sqrt(absPnl) / Math.sqrt(maxPnl);
              const heightPct = absPnl === 0 ? 0 : Math.max(6, scaleFactor * 50);

              return (
                <div key={h.hour} className="flex-1 relative group z-10">
                  <div
                    role="img"
                    aria-label={`${h.hour}:00, ${isPos ? 'positive' : 'negative'} performance, ${fmtUSD(h.pnl)} PnL, ${Number(h.winRate || 0).toFixed(0)}% win rate`}
                    className={cn(
                      "absolute left-0 right-0 transition-all duration-300 opacity-60",
                      isPos
                        ? "bg-green border-t border-green/40 rounded-t-[2px]"
                        : "bg-red border-b border-red/40 rounded-b-[2px]",
                      hoverHour?.hour === h.hour && "opacity-100 ring-1 ring-accent/40"
                    )}
                    style={{
                      height: `${heightPct}%`,
                      top: '50%',
                      transform: isPos ? 'translateY(-100%)' : 'translateY(0)'
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-6 flex justify-between gap-0.5 pointer-events-none">
          {validData.map((h) => (
            <div key={h.hour} className="flex-1 flex flex-col items-center justify-center">
              <span className="text-[7px] text-dim font-mono font-bold text-center hidden sm:block">{h.hour}</span>
              <span className="text-[7px] text-dim font-mono font-bold text-center block sm:hidden">
                {h.hour % 3 === 0 ? h.hour : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
