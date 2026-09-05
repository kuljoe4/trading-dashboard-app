import React, { useId, useMemo, useState, useRef, useEffect } from 'react';
import { fmtUSD, solveSmoothing, pnlClass } from '../lib/theme';
import { formatDuration } from '../lib/formatters';
import { cn, Tooltip } from '../components/ui/primitives';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, List, Grid } from 'lucide-react';

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

export const EquityCurve = ({ data = [], height = 180, colorDrawdown = false, hideAxes = false, configChanges = [] }) => {
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
      return { x, y, pnl: d.pnl, ts: d.ts, configChange: d.configChange };
    });

    return { points: pts, viewMin: vMin, viewMax: vMax, viewRange: vRange };
  }, [data]);

  // Derived list of config change markers on timeline
  const changeMarkers = useMemo(() => {
    if (!points || points.length < 2) return [];
    const markers = [];

    // 1) Markers embedded in points
    points.forEach(p => {
      if (p.configChange) {
        markers.push({
          x: p.x,
          y: p.y,
          ts: p.ts,
          label: p.configChange.label || 'Config Updated',
          diffs: Array.isArray(p.configChange.diffs) ? p.configChange.diffs : [p.configChange.message || 'Strategy config updated']
        });
      }
    });

    // 2) External configChanges array matched by timestamp
    if (Array.isArray(configChanges) && configChanges.length > 0) {
      const minTs = points[0].ts || 0;
      const maxTs = points[points.length - 1].ts || Date.now();
      const tsRange = Math.max(1, maxTs - minTs);

      configChanges.forEach(cc => {
        if (cc && cc.ts) {
          const clampedTs = Math.max(minTs, Math.min(maxTs, cc.ts));
          const x = ((clampedTs - minTs) / tsRange) * 100;
          markers.push({
            x,
            y: 50,
            ts: cc.ts,
            label: cc.label || 'Config Updated',
            diffs: Array.isArray(cc.diffs) ? cc.diffs : [cc.message || 'Strategy parameters updated']
          });
        }
      });
    }

    return markers;
  }, [points, configChanges]);

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
            <feGaussianBlur stdDeviation="0.15" result="blur" />
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
          strokeWidth="0.4"
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
          strokeWidth="0.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${gradientId}-clip-below)`}
          filter={`url(#${glowId})`}
          className="transition-all duration-700"
        />

        {/* Config Change Timeline Markers */}
        {changeMarkers.map((marker, i) => (
          <g key={`cfg-marker-${i}`} className="cursor-pointer">
            <line
              x1={marker.x} y1="0" x2={marker.x} y2="100"
              stroke="var(--color-amber)" strokeWidth="0.3" strokeDasharray="1.5,1.5" opacity="0.7"
            />
            <circle cx={marker.x} cy={marker.y || 50} r="2" fill="var(--color-amber)"  vectorEffect="non-scaling-stroke" />
          </g>
        ))}

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
             vectorEffect="non-scaling-stroke" />
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
  const [viewMode, setViewMode] = useState('GRID'); // 'GRID' | 'LIST'
  const [selectedDayDetail, setSelectedDayDetail] = useState(null);

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

  // Aggregate daily stats: Map key 'YYYY-MM-DD' => { pnl, wins, losses, count, trades }
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
        entry = { pnl: 0, wins: 0, losses: 0, count: 0, trades: [] };
        map.set(key, entry);
      }
      const pnl = Number(t.pnl || 0);
      entry.pnl += pnl;
      entry.count += 1;
      entry.trades.push(t);
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

  // Active Month Days List for Agenda View
  const monthActiveDaysList = useMemo(() => {
    const list = [];
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const key = `${year}-${String(mNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const stats = dailyStatsMap.get(key);
      if (stats && stats.count > 0) {
        list.push({ key, dayNum, ...stats });
      }
    }
    return list;
  }, [daysInMonth, year, mNum, dailyStatsMap]);

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-4 bg-surface/30 border border-border/50 rounded-2xl p-4 sm:p-6 relative" role="region" aria-label="Strategy calendar profit and loss breakdown">
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

        <div className="flex items-center gap-3 self-end sm:self-auto flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[8px] text-dim/50 font-black uppercase tracking-widest">Monthly P&L</span>
              <span className={cn("text-base sm:text-lg font-black font-mono tracking-tight", monthlySummary.monthlyPnl >= 0 ? "text-green" : "text-red")}>
                {fmtUSD(monthlySummary.monthlyPnl)}
              </span>
            </div>
            <div className="flex flex-col items-end pl-3 border-l border-border/30">
              <span className="text-[8px] text-dim/50 font-black uppercase tracking-widest">Win Rate</span>
              <span className="text-base sm:text-lg font-black font-mono text-text">
                {monthlySummary.winRate.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* View Toggle (Grid / Agenda) */}
          <div className="flex items-center bg-background/60 border border-border/40 p-0.5 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('GRID')}
              aria-label="Grid View"
              title="Calendar Grid View"
              className={cn(
                "p-1.5 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer flex items-center gap-1 text-[10px] font-bold uppercase",
                viewMode === 'GRID' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
              )}
            >
              <Grid size={13} />
              <span className="hidden xs:inline">Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('LIST')}
              aria-label="Agenda View"
              title="Daily Agenda List View"
              className={cn(
                "p-1.5 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer flex items-center gap-1 text-[10px] font-bold uppercase",
                viewMode === 'LIST' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
              )}
            >
              <List size={13} />
              <span className="hidden xs:inline">Agenda</span>
            </button>
          </div>

          {/* Month Navigation */}
          <div className="flex items-center gap-1 bg-background/50 border border-border/40 p-1 rounded-xl">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous Month"
              className="p-1.5 hover:bg-surface text-dim hover:text-text rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next Month"
              className="p-1.5 hover:bg-surface text-dim hover:text-text rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Calendar Render (Grid vs. Agenda) */}
      {viewMode === 'GRID' ? (
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {daysOfWeek.map((day) => (
            <div key={day} className="text-center text-[8px] xs:text-[9px] text-dim font-black uppercase tracking-wider py-1 truncate">
              {day}
            </div>
          ))}

          {/* Empty cells before month start */}
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[58px] sm:min-h-[72px] rounded-xl bg-surface/10 border border-border/10 opacity-30" />
          ))}

          {/* Days of month */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const key = `${year}-${String(mNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const stats = dailyStatsMap.get(key);
            const hasTrades = stats && stats.count > 0;
            const isProfitable = hasTrades && stats.pnl >= 0;

            const tooltipContent = hasTrades
              ? `${key}: PnL ${fmtUSD(stats.pnl)}, ${stats.wins}W / ${stats.losses}L (${stats.count} total trades). Tap for details.`
              : `${key}: No trades recorded`;

            return (
              <Tooltip key={key} content={tooltipContent}>
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() => {
                    if (hasTrades) {
                      setSelectedDayDetail({ dateKey: key, dayNum, ...stats });
                    }
                  }}
                  aria-label={tooltipContent}
                  className={cn(
                    "min-h-[58px] sm:min-h-[72px] p-1.5 sm:p-2 rounded-xl border flex flex-col justify-between transition-all relative group cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none overflow-hidden text-left w-full",
                    hasTrades
                      ? isProfitable
                        ? "bg-green/10 border-green/30 hover:border-green/60 hover:scale-[1.02] active:scale-95"
                        : "bg-red/10 border-red/30 hover:border-red/60 hover:scale-[1.02] active:scale-95"
                      : "bg-surface/20 border-border/20 hover:border-border/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-0.5 w-full min-w-0">
                    <span className="text-[9.5px] sm:text-[11px] font-mono font-bold text-dim group-hover:text-text shrink-0">{dayNum}</span>
                    {hasTrades && (
                      <span className="text-[6.5px] xs:text-[7.5px] font-black uppercase font-mono px-1 py-0.2 rounded bg-background/60 border border-border/20 text-dim truncate">
                        {stats.wins}W/{stats.losses}L
                      </span>
                    )}
                  </div>

                  {hasTrades ? (
                    <div className="flex flex-col items-end w-full min-w-0 mt-1">
                      <span className={cn("text-[9px] xs:text-[10.5px] sm:text-xs font-black font-mono tracking-tight truncate w-full text-right leading-tight", isProfitable ? "text-green" : "text-red")}>
                        {fmtUSD(stats.pnl)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-full my-auto">
                      <span className="w-1 h-1 rounded-full bg-dim/20" />
                    </div>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
      ) : (
        /* Agenda List View for Small Viewports & Accessibility */
        <div className="space-y-2">
          {monthActiveDaysList.length === 0 ? (
            <div className="p-8 text-center text-dim font-mono text-[10px] uppercase tracking-widest border border-dashed border-border/30 rounded-xl">
              No Trades Recorded in {monthLabel} {year}
            </div>
          ) : (
            monthActiveDaysList.map((day) => {
              const isProfitable = day.pnl >= 0;
              const winRate = day.count > 0 ? ((day.wins / day.count) * 100).toFixed(0) : 0;

              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedDayDetail(day)}
                  className="w-full text-left p-3 rounded-xl bg-surface/40 hover:bg-surface border border-border/30 hover:border-accent/40 transition-all flex items-center justify-between gap-3 group focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
                  aria-label={`${day.key}: ${fmtUSD(day.pnl)}, ${day.wins} Wins, ${day.losses} Losses (${winRate}% Win Rate). Tap for full trade details.`}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex flex-col items-center justify-center font-mono shrink-0 border",
                      isProfitable ? "bg-green/10 border-green/30 text-green" : "bg-red/10 border-red/30 text-red"
                    )}>
                      <span className="text-[9px] uppercase font-bold text-dim">{monthLabel.substring(0, 3)}</span>
                      <span className="text-sm font-black leading-none">{day.dayNum}</span>
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black font-mono text-text uppercase">{day.key}</span>
                        <span className="text-[8px] bg-background border border-border/30 font-black px-1.5 py-0.5 rounded text-dim font-mono">
                          {day.wins}W / {day.losses}L ({winRate}% WR)
                        </span>
                      </div>
                      <span className="text-[9px] text-dim/80 font-medium">
                        {day.count} {day.count === 1 ? 'Trade' : 'Trades'} executed
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end">
                      <span className={cn("text-xs sm:text-sm font-black font-mono tracking-tight", isProfitable ? "text-green" : "text-red")}>
                        {fmtUSD(day.pnl)}
                      </span>
                      <span className="text-[8px] text-dim uppercase tracking-wider font-bold">Daily PnL</span>
                    </div>
                    <ChevronRight size={16} className="text-dim group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Daily Detail Interactive Popover Modal / Drawer */}
      {selectedDayDetail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Daily details for ${selectedDayDetail.dateKey}`}
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedDayDetail(null)}
        >
          <div
            className="bg-background border-t sm:border border-border/60 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[85vh] flex flex-col gap-4 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-border/20 pb-3">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
                  selectedDayDetail.pnl >= 0 ? "bg-green/10 border-green/30 text-green" : "bg-red/10 border-red/30 text-red"
                )}>
                  <CalendarIcon size={18} />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-sm sm:text-base font-black uppercase text-text font-mono tracking-tight">
                    {selectedDayDetail.dateKey} Details
                  </h3>
                  <span className="text-[9.5px] text-dim font-bold uppercase tracking-wider font-mono">
                    {selectedDayDetail.count} {selectedDayDetail.count === 1 ? 'Trade' : 'Trades'} Recorded
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDayDetail(null)}
                aria-label="Close daily details"
                className="p-1.5 rounded-lg bg-surface/50 border border-border/40 text-dim hover:text-text hover:bg-surface transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            {/* Summary Stat Grid */}
            <div className="grid grid-cols-3 gap-2 bg-surface/30 p-3 rounded-xl border border-border/30">
              <div className="flex flex-col items-center justify-center text-center">
                <span className="text-[8px] text-dim/60 font-black uppercase tracking-widest">Daily P&L</span>
                <span className={cn("text-xs sm:text-sm font-black font-mono mt-0.5", selectedDayDetail.pnl >= 0 ? "text-green" : "text-red")}>
                  {fmtUSD(selectedDayDetail.pnl)}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center text-center border-x border-border/20">
                <span className="text-[8px] text-dim/60 font-black uppercase tracking-widest">Wins / Losses</span>
                <span className="text-xs sm:text-sm font-black font-mono text-text mt-0.5">
                  {selectedDayDetail.wins}W / {selectedDayDetail.losses}L
                </span>
              </div>
              <div className="flex flex-col items-center justify-center text-center">
                <span className="text-[8px] text-dim/60 font-black uppercase tracking-widest">Win Rate</span>
                <span className="text-xs sm:text-sm font-black font-mono text-accent mt-0.5">
                  {selectedDayDetail.count > 0 ? ((selectedDayDetail.wins / selectedDayDetail.count) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>

            {/* Daily Executed Trades List */}
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[50vh] pr-1">
              <span className="text-[9px] text-dim font-black uppercase tracking-widest">Executed Trades</span>
              {(!selectedDayDetail.trades || selectedDayDetail.trades.length === 0) ? (
                <div className="p-4 text-center text-dim font-mono text-[10px] uppercase">No trade items recorded</div>
              ) : (
                selectedDayDetail.trades.map((t, idx) => {
                  const pnl = Number(t.pnl || 0);
                  const isLong = t.direction === 'LONG' || t.side === 'BUY';
                  const exitTimeStr = t.exit_ts ? new Date(t.exit_ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                  return (
                    <div
                      key={t.id || `trade-${idx}`}
                      className="p-3 rounded-xl bg-background/50 border border-border/30 flex items-center justify-between gap-3 text-xs font-mono"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] font-black uppercase border shrink-0",
                          isLong ? "bg-green/10 text-green border-green/30" : "bg-red/10 text-red border-red/30"
                        )}>
                          {t.direction || (isLong ? 'LONG' : 'SHORT')}
                        </span>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-text truncate uppercase">{t.symbol}</span>
                            {t.is_knife && (
                              <span className="text-[7.5px] bg-red/20 text-red border border-red/30 font-black px-1 py-0.2 rounded uppercase shrink-0">🗡️ KNIFE</span>
                            )}
                          </div>
                          <span className="text-[8.5px] text-dim font-medium">
                            {exitTimeStr} {t.exit_reason ? `· ${t.exit_reason}` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span className={cn("font-bold text-xs font-mono", pnl >= 0 ? "text-green" : "text-red")}>
                          {fmtUSD(pnl)}
                        </span>
                        {t.entry_price && t.exit_price && (
                          <span className="text-[8px] text-dim/60 font-mono">
                            ${t.entry_price} → ${t.exit_price}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
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
            strokeWidth="0.4"
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
              <circle cx={hoverPos.x} cy={hoverPos.y} r="2.5" fill="var(--color-accent)" className="animate-pulse"  vectorEffect="non-scaling-stroke" />
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

export const StrategyPerformanceOverlayChart = ({ trades = [], height = 280, showPnl = true, showHitRate = true, showPf = false, showSharpe = false, showSortino = false, startingBalance, configChanges = [], onToggleSeries }) => {
  const containerRef = useRef(null);
  const brushRef = useRef(null);
  const chartId = useId().replace(/:/g, '');
  const pnlGradientId = `pnl-grad-${chartId}`;

  const [hoverData, setHoverData] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(null);
  const [activeConfigDiff, setActiveConfigDiff] = useState(null);

  // New state controls: mode, zoom preset, range selection
  const [axisMode, setAxisMode] = useState('time'); // 'time' | 'trade'
  const [activePreset, setActivePreset] = useState('ALL'); // '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'
  const [rangeSpan, setRangeSpan] = useState([0, 100]); // percentage [minX, maxX]
  const [isDraggingBrush, setIsDraggingBrush] = useState(false);
  const [brushDragStart, setBrushDragStart] = useState(null);

  // Pre-process and sort all raw trades chronologically
  const sortedRawTrades = useMemo(() => {
    const raw = Array.isArray(trades) ? trades : [];
    if (raw.length === 0) return [];

    const safe = raw.map((t, i) => {
      const exitTs = t?.exit_ts_ms !== undefined
        ? t.exit_ts_ms
        : (t?.exit_ts || t?.createdAt ? new Date(t.exit_ts || t.createdAt).getTime() : i);
      const entryTs = t?.entry_ts_ms !== undefined
        ? t.entry_ts_ms
        : (t?.entry_ts ? new Date(t.entry_ts).getTime() : exitTs);
      return { trade: t, exitTs, entryTs };
    });

    safe.sort((a, b) => a.exitTs - b.exitTs);
    return safe;
  }, [trades]);

  // Handle Preset Time Selection
  const handlePresetSelect = (preset) => {
    setActivePreset(preset);
    if (preset === 'ALL' || sortedRawTrades.length < 2) {
      setRangeSpan([0, 100]);
      return;
    }

    const maxTs = sortedRawTrades[sortedRawTrades.length - 1].exitTs;
    const minTs = sortedRawTrades[0].exitTs;
    const totalDuration = maxTs - minTs;
    if (totalDuration <= 0) {
      setRangeSpan([0, 100]);
      return;
    }

    const now = maxTs;
    let cutoffTs = minTs;

    const DAY = 86400000;
    if (preset === '1W') cutoffTs = now - 7 * DAY;
    else if (preset === '1M') cutoffTs = now - 30 * DAY;
    else if (preset === '3M') cutoffTs = now - 90 * DAY;
    else if (preset === '6M') cutoffTs = now - 180 * DAY;
    else if (preset === 'YTD') cutoffTs = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    else if (preset === '1Y') cutoffTs = now - 365 * DAY;

    cutoffTs = Math.max(minTs, cutoffTs);
    const startPct = Math.max(0, Math.min(95, ((cutoffTs - minTs) / totalDuration) * 100));
    setRangeSpan([startPct, 100]);
  };

  // Filter trades based on rangeSpan
  const filteredTradeItems = useMemo(() => {
    if (sortedRawTrades.length === 0) return [];
    if (rangeSpan[0] <= 0 && rangeSpan[1] >= 100) return sortedRawTrades;

    const minTs = sortedRawTrades[0].exitTs;
    const maxTs = sortedRawTrades[sortedRawTrades.length - 1].exitTs;
    const totalDuration = maxTs - minTs;

    if (totalDuration <= 0) return sortedRawTrades;

    const startTs = minTs + (rangeSpan[0] / 100) * totalDuration;
    const endTs = minTs + (rangeSpan[1] / 100) * totalDuration;

    return sortedRawTrades.filter(item => item.exitTs >= startTs && item.exitTs <= endTs);
  }, [sortedRawTrades, rangeSpan]);

  // Compute performance points and curves over filtered trades
  const { points, pnlMin, pnlMax, pnlRange, hrMin, hrMax, hrRange, maxRatio, adaptiveTicks } = useMemo(() => {
    const rawItems = filteredTradeItems;
    if (rawItems.length < 2) {
      return {
        points: [], pnlMin: 0, pnlMax: 10, pnlRange: 10, hrMin: 0, hrMax: 100, hrRange: 100, maxRatio: 3.0, adaptiveTicks: []
      };
    }

    const count = rawItems.length;
    let totalNetPnl = 0;
    for (let i = 0; i < count; i++) {
      totalNetPnl += Number(rawItems[i].trade?.pnl || 0);
    }

    let cumPnl = 0;
    let totalWins = 0;
    let grossWin = 0;
    let grossLoss = 0;

    let rollingBal = startingBalance ? Math.max(1, startingBalance - totalNetPnl) : 10000;
    let sumReturnPct = 0;
    let sumSqReturnPct = 0;
    let downsideSumSqReturnPct = 0;

    const series = new Array(count);
    const minTs = rawItems[0].exitTs;
    const maxTs = rawItems[count - 1].exitTs;
    const timeSpanMs = Math.max(1, maxTs - minTs);

    for (let idx = 0; idx < count; idx++) {
      const item = rawItems[idx];
      const t = item.trade;
      const pnl = Number(t?.pnl || 0);
      cumPnl += pnl;

      const retPct = rollingBal > 0 ? (pnl / rollingBal) * 100 : 0;
      rollingBal = Math.max(1, rollingBal + pnl);

      sumReturnPct += retPct;
      sumSqReturnPct += retPct * retPct;

      if (pnl > 0) {
        totalWins++;
        grossWin += pnl;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
        downsideSumSqReturnPct += retPct * retPct;
      }

      const tradeNum = idx + 1;
      const hitRate = (totalWins / tradeNum) * 100;
      const pf = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? 10 : 0);

      let sharpe = 0;
      let sortino = 0;

      if (tradeNum > 1) {
        const meanReturn = sumReturnPct / tradeNum;
        const variance = Math.max(0, (sumSqReturnPct / tradeNum) - (meanReturn * meanReturn));
        const stdDev = Math.sqrt(variance);
        const downsideStdDev = Math.sqrt(downsideSumSqReturnPct / tradeNum);

        if (stdDev > 0) sharpe = meanReturn / stdDev;
        if (downsideStdDev > 0) sortino = meanReturn / downsideStdDev;
      }

      const durMs = Math.max(0, item.exitTs - item.entryTs);

      series[idx] = {
        tradeIndex: tradeNum,
        rawIndex: idx,
        symbol: t.symbol || '---',
        direction: (t.direction || 'LONG').toUpperCase(),
        entryPrice: Number(t.entry_price || t.price || 0),
        exitPrice: Number(t.exit_price || 0),
        strategy: t.strategy_label || t.strategy || 'Base Strategy',
        durationMs: durMs,
        pnl,
        cumPnl,
        hitRate,
        pf,
        sharpe,
        sortino,
        ts: item.exitTs
      };
    }

    const pnlValues = series.map(s => s.cumPnl);
    const rawPnlMin = Math.min(0, ...pnlValues);
    const rawPnlMax = Math.max(0.1, ...pnlValues);
    const rawPnlRange = rawPnlMax - rawPnlMin;
    const pnlPad = rawPnlRange * 0.15;
    const minPnl = rawPnlMin - pnlPad;
    const maxPnl = rawPnlMax + pnlPad;
    const rangePnl = maxPnl - minPnl;

    const hrValues = series.map(s => s.hitRate);
    const rawHrMin = Math.max(0, Math.min(...hrValues) - 5);
    const rawHrMax = Math.min(100, Math.max(...hrValues) + 5);
    const rangeHr = Math.max(10, rawHrMax - rawHrMin);

    const ratioValues = [];
    series.forEach(s => {
      if (s.pf > 0 && s.pf < 50) ratioValues.push(s.pf);
      if (s.sharpe > 0) ratioValues.push(s.sharpe);
      if (s.sortino > 0) ratioValues.push(s.sortino);
    });
    const peakRatio = ratioValues.length > 0 ? Math.max(...ratioValues) : 2.5;
    const ratioScaleMax = Math.max(3.0, peakRatio * 1.15);

    const pts = series.map((d, i) => {
      // Calculate x position based on axisMode
      let x = 0;
      if (axisMode === 'time' && timeSpanMs > 0) {
        x = ((d.ts - minTs) / timeSpanMs) * 100;
      } else {
        x = (i / (series.length - 1)) * 100;
      }

      const yPnl = 100 - ((d.cumPnl - minPnl) / rangePnl) * 100;
      const yHr = 100 - ((d.hitRate - rawHrMin) / rangeHr) * 100;
      const yPf = 100 - (Math.min(ratioScaleMax, Math.max(0, d.pf)) / ratioScaleMax) * 100;
      const ySharpe = 100 - (Math.min(ratioScaleMax, Math.max(0, d.sharpe)) / ratioScaleMax) * 100;
      const ySortino = 100 - (Math.min(ratioScaleMax, Math.max(0, d.sortino)) / ratioScaleMax) * 100;

      return {
        x,
        yPnl,
        yHr,
        yPf,
        ySharpe,
        ySortino,
        cumPnl: d.cumPnl,
        hitRate: d.hitRate,
        pf: d.pf,
        sharpe: d.sharpe,
        sortino: d.sortino,
        pnl: d.pnl,
        symbol: d.symbol,
        direction: d.direction,
        entryPrice: d.entryPrice,
        exitPrice: d.exitPrice,
        strategy: d.strategy,
        durationMs: d.durationMs,
        tradeIndex: d.tradeIndex,
        ts: d.ts
      };
    });

    // Compute Adaptive X-Axis Ticks (Max 8 - 12 Ticks)
    const tickCount = Math.min(10, Math.max(4, Math.floor(count / 10) + 4));
    const ticks = [];

    if (axisMode === 'time') {
      const DAY_MS = 86400000;

      for (let k = 0; k < tickCount; k++) {
        const frac = k / (tickCount - 1);
        const tickTs = minTs + frac * timeSpanMs;
        const tickX = frac * 100;

        let label = '';
        if (timeSpanMs < 2 * DAY_MS) {
          label = new Date(tickTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (timeSpanMs < 60 * DAY_MS) {
          label = new Date(tickTs).toLocaleDateString([], { month: 'short', day: 'numeric' });
        } else {
          label = new Date(tickTs).toLocaleDateString([], { month: 'short', year: '2-digit' });
        }

        ticks.push({ x: tickX, label, ts: tickTs });
      }
    } else {
      for (let k = 0; k < tickCount; k++) {
        const frac = k / (tickCount - 1);
        const tradeIdx = Math.round(1 + frac * (count - 1));
        const tickX = frac * 100;
        ticks.push({ x: tickX, label: `#${tradeIdx}`, tradeIdx });
      }
    }

    return {
      points: pts,
      pnlMin: minPnl,
      pnlMax: maxPnl,
      pnlRange: rangePnl,
      hrMin: rawHrMin,
      hrMax: rawHrMax,
      hrRange: rangeHr,
      maxRatio: ratioScaleMax,
      adaptiveTicks: ticks
    };
  }, [filteredTradeItems, startingBalance, axisMode]);

  const pnlPathD = useMemo(() => {
    if (!points.length) return '';
    return solveSmoothing(points.map(p => ({ x: p.x, y: p.yPnl })));
  }, [points]);

  const hrPathD = useMemo(() => {
    if (!points.length) return '';
    return solveSmoothing(points.map(p => ({ x: p.x, y: p.yHr })));
  }, [points]);

  const pfPathD = useMemo(() => {
    if (!points.length) return '';
    return solveSmoothing(points.map(p => ({ x: p.x, y: p.yPf })));
  }, [points]);

  const sharpePathD = useMemo(() => {
    if (!points.length) return '';
    return solveSmoothing(points.map(p => ({ x: p.x, y: p.ySharpe })));
  }, [points]);

  const sortinoPathD = useMemo(() => {
    if (!points.length) return '';
    return solveSmoothing(points.map(p => ({ x: p.x, y: p.ySortino })));
  }, [points]);

  const zeroPnlY = useMemo(() => {
    return 100 - ((0 - pnlMin) / pnlRange) * 100;
  }, [pnlMin, pnlRange]);

  const pnlAreaD = useMemo(() => {
    if (points.length < 2 || !pnlPathD) return '';
    return `${pnlPathD} L 100 ${zeroPnlY} L 0 ${zeroPnlY} Z`;
  }, [pnlPathD, points, zeroPnlY]);

  const handleInteraction = (clientX) => {
    if (!containerRef.current || points.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));

    let closestIdx = 0;
    let minDiff = Math.abs(points[0].x - xPct);

    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].x - xPct);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setHoverData(points[closestIdx]);
    setFocusedIndex(closestIdx);
  };

  const handleKeyDown = (e) => {
    if (points.length < 2) return;
    const currentIdx = focusedIndex !== null ? focusedIndex : points.length - 1;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = Math.min(points.length - 1, currentIdx + 1);
      setFocusedIndex(nextIdx);
      setHoverData(points[nextIdx]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = Math.max(0, currentIdx - 1);
      setFocusedIndex(prevIdx);
      setHoverData(points[prevIdx]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIndex(0);
      setHoverData(points[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const lastIdx = points.length - 1;
      setFocusedIndex(lastIdx);
      setHoverData(points[lastIdx]);
    } else if (e.key === 'Escape') {
      setHoverData(null);
      setFocusedIndex(null);
    }
  };

  // Draggable Mini Brush Range Slider Handlers
  const handleBrushMouseDown = (e, type) => {
    e.stopPropagation();
    setIsDraggingBrush(type);
    setBrushDragStart(e.clientX);
  };

  const handleBrushMouseMove = (e) => {
    if (!isDraggingBrush || !brushRef.current) return;
    const rect = brushRef.current.getBoundingClientRect();
    const deltaX = e.clientX - brushDragStart;
    const deltaPct = (deltaX / rect.width) * 100;

    setBrushDragStart(e.clientX);

    if (isDraggingBrush === 'left') {
      setRangeSpan(prev => [Math.max(0, Math.min(prev[1] - 5, prev[0] + deltaPct)), prev[1]]);
    } else if (isDraggingBrush === 'right') {
      setRangeSpan(prev => [prev[0], Math.min(100, Math.max(prev[0] + 5, prev[1] + deltaPct))]);
    } else if (isDraggingBrush === 'move') {
      const width = rangeSpan[1] - rangeSpan[0];
      let newStart = rangeSpan[0] + deltaPct;
      let newEnd = rangeSpan[1] + deltaPct;

      if (newStart < 0) {
        newStart = 0;
        newEnd = width;
      }
      if (newEnd > 100) {
        newEnd = 100;
        newStart = 100 - width;
      }
      setRangeSpan([newStart, newEnd]);
    }
  };

  const handleBrushMouseUp = () => {
    setIsDraggingBrush(false);
  };

  useEffect(() => {
    if (isDraggingBrush) {
      window.addEventListener('mousemove', handleBrushMouseMove);
      window.addEventListener('mouseup', handleBrushMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleBrushMouseMove);
        window.removeEventListener('mouseup', handleBrushMouseUp);
      };
    }
  }, [isDraggingBrush, rangeSpan]);

  if (!trades || trades.length < 2) {
    return (
      <div style={{ height: `${height}px` }} className="flex flex-col items-center justify-center bg-surface/20 border border-border/40 rounded-2xl border-dashed">
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Insufficient Trade History for Performance Overlay</span>
      </div>
    );
  }

  const activePoint = hoverData || (focusedIndex !== null ? points[focusedIndex] : points[points.length - 1]);

  return (
    <div className="flex flex-col gap-2.5 w-full select-none">
      {/* Top Controls Bar: Axis Mode, Zoom Presets, Series Toggles */}
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap text-xs font-mono">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Axis Mode Switcher */}
          <div className="flex items-center bg-surface/60 border border-border/40 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setAxisMode('time')}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer",
                axisMode === 'time' ? "bg-accent/20 text-accent font-black" : "text-dim hover:text-text"
              )}
            >
              By Time
            </button>
            <button
              type="button"
              onClick={() => setAxisMode('trade')}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer",
                axisMode === 'trade' ? "bg-accent/20 text-accent font-black" : "text-dim hover:text-text"
              )}
            >
              By Trade
            </button>
          </div>

          {/* Time Zoom Range Presets */}
          <div className="flex items-center bg-surface/40 border border-border/30 rounded-lg p-0.5">
            {['1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(p => (
              <button
                key={p}
                type="button"
                onClick={() => handlePresetSelect(p)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[9.5px] font-bold transition-all cursor-pointer",
                  activePreset === p ? "bg-surface border border-border/40 text-text font-black" : "text-dim/60 hover:text-text"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Active Point Indicator Banner */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] text-dim/80 uppercase tracking-wider font-sans font-bold bg-surface/50 border border-border/30 px-2 py-0.5 rounded-lg">
            {hoverData || focusedIndex !== null ? `Trade #${activePoint?.tradeIndex} (${activePoint?.symbol})` : 'Strategy Totals'}
          </span>
          {showPnl && (
            <span className={cn("font-bold text-xs font-mono", (activePoint?.cumPnl || 0) >= 0 ? "text-green" : "text-red")}>
              PnL: {fmtUSD(activePoint?.cumPnl)}
            </span>
          )}
          {showHitRate && (
            <span className="font-bold text-xs font-mono text-accent">
              Hit Rate: {Number(activePoint?.hitRate || 0).toFixed(1)}%
            </span>
          )}
          {showPf && (
            <span className="font-bold text-xs font-mono text-purple-400">
              PF: {Number(activePoint?.pf || 0).toFixed(2)}
            </span>
          )}
          {showSharpe && (
            <span className="font-bold text-xs font-mono text-amber">
              Sh: {Number(activePoint?.sharpe || 0).toFixed(2)}
            </span>
          )}
          {showSortino && (
            <span className="font-bold text-xs font-mono text-cyan-400">
              So: {Number(activePoint?.sortino || 0).toFixed(2)}
            </span>
          )}
        </div>

        {/* Series Toggles */}
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          {onToggleSeries ? (
            <>
              <button
                type="button"
                onClick={() => onToggleSeries('showPnl')}
                aria-label="Toggle PnL series"
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                  showPnl ? "bg-green/10 border-green/30 text-green font-bold" : "bg-surface/30 border-border/20 text-dim/50 hover:text-text"
                )}
              >
                <span className="w-2 h-0.5 bg-green rounded-full inline-block" /> PnL ($)
              </button>
              <button
                type="button"
                onClick={() => onToggleSeries('showHitRate')}
                aria-label="Toggle Hit Rate series"
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                  showHitRate ? "bg-accent/10 border-accent/30 text-accent font-bold" : "bg-surface/30 border-border/20 text-dim/50 hover:text-text"
                )}
              >
                <span className="w-2 h-0.5 bg-accent rounded-full inline-block" /> Hit Rate (%)
              </button>
            </>
          ) : (
            <>
              {showPnl && <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-green rounded-full inline-block" /> PnL ($)</span>}
              {showHitRate && <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-accent rounded-full inline-block" /> Hit Rate (%)</span>}
              {showPf && <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-purple rounded-full inline-block" /> Profit Factor</span>}
              {showSharpe && <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-amber rounded-full inline-block" /> Sharpe</span>}
              {showSortino && <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-cyan-400 rounded-full inline-block" /> Sortino</span>}
            </>
          )}
        </div>
      </div>

      {/* Chart Frame with Dual Axes & Focus Ring */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-border/30 bg-surface/20 p-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none tab-focus-ring"
        style={{ height: `${height}px`, touchAction: 'pan-y' }}
        onMouseMove={(e) => handleInteraction(e.clientX)}
        onTouchMove={(e) => e.touches[0] && handleInteraction(e.touches[0].clientX)}
        onMouseLeave={() => { setHoverData(null); }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="region"
        aria-label={`Strategy Performance Overlay chart with ${points.length} trades. Active Trade #${activePoint?.tradeIndex}: Cumulative PnL ${fmtUSD(activePoint?.cumPnl)}, Hit Rate ${Number(activePoint?.hitRate || 0).toFixed(1)}%. Use Left and Right arrow keys to step through trade points.`}
      >
        {/* Dual Axis Labels Overlay (Left: PnL $, Right: Hit Rate / Ratio) */}
        <div className="absolute inset-y-2 left-2 flex flex-col justify-between text-[8px] font-mono font-bold text-dim/60 pointer-events-none z-10">
          <span>{fmtUSD(pnlMax)}</span>
          <span>{fmtUSD((pnlMax + pnlMin) / 2)}</span>
          <span>{fmtUSD(pnlMin)}</span>
        </div>
        <div className="absolute inset-y-2 right-2 flex flex-col justify-between text-[8px] font-mono font-bold text-accent/80 text-right pointer-events-none z-10">
          <span>{showHitRate ? `${Math.round(hrMax)}%` : `${maxRatio.toFixed(1)}R`}</span>
          <span>{showHitRate ? `${Math.round((hrMax + hrMin) / 2)}%` : `${(maxRatio / 2).toFixed(1)}R`}</span>
          <span>{showHitRate ? `${Math.round(hrMin)}%` : '0.0R'}</span>
        </div>

        <svg className="w-full h-full overflow-visible px-6 pb-4" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`${pnlGradientId}-pos`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-green)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-green)" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id={`${pnlGradientId}-neg`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-red)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-red)" stopOpacity="0.0" />
            </linearGradient>
            <filter id={`${chartId}-glow`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="0.15" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Grid Lines & Ticks */}
          {[0, 25, 50, 75, 100].map(y => (
            <g key={y}>
              <line
                x1="0"
                y1={y}
                x2="100"
                y2={y}
                stroke="var(--color-border)"
                strokeWidth="0.25"
                strokeDasharray="1,3"
                opacity="0.4"
              />
            </g>
          ))}

          {showPnl && (
            <line
              x1="0"
              y1={zeroPnlY}
              x2="100"
              y2={zeroPnlY}
              stroke="var(--color-text)"
              strokeWidth="0.4"
              strokeDasharray="2,2"
              opacity="0.3"
            />
          )}

          {showPnl && pnlAreaD && (
            <path
              d={pnlAreaD}
              fill={`url(#${pnlGradientId}-${(activePoint?.cumPnl || 0) >= 0 ? 'pos' : 'neg'})`}
            />
          )}

          {showPnl && pnlPathD && (
            <path
              d={pnlPathD}
              fill="none"
              stroke={(activePoint?.cumPnl || 0) >= 0 ? 'var(--color-green)' : 'var(--color-red)'}
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${chartId}-glow)`}
            />
          )}

          {showPf && pfPathD && (
            <path
              d={pfPathD}
              fill="none"
              stroke="var(--color-purple)"
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${chartId}-glow)`}
            />
          )}

          {showSharpe && sharpePathD && (
            <path
              d={sharpePathD}
              fill="none"
              stroke="var(--color-amber)"
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${chartId}-glow)`}
            />
          )}

          {showSortino && sortinoPathD && (
            <path
              d={sortinoPathD}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${chartId}-glow)`}
            />
          )}

          {showHitRate && hrPathD && (
            <path
              d={hrPathD}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="0.6"
              strokeDasharray={showPnl ? '2.5,2' : 'none'}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${chartId}-glow)`}
            />
          )}

          {/* Bottom Baseline Win/Loss Markers */}
          {points.map((pt, i) => {
            const isWin = pt.pnl > 0;
            const isLoss = pt.pnl < 0;
            if (!isWin && !isLoss) return null;

            return (
              <circle
                key={`wl-marker-${i}`}
                cx={pt.x}
                cy={96}
                r={points.length > 300 ? "0.8" : "1.2"}
                fill={isWin ? "var(--color-green)" : "var(--color-red)"}
                opacity={activePoint?.tradeIndex === pt.tradeIndex ? "1" : "0.6"}
              />
            );
          })}

          {/* Config Change Event Markers */}
          {configChanges && configChanges.length > 0 && configChanges.map((cc, i) => {
            const minTs = points[0]?.ts || 0;
            const maxTs = points[points.length - 1]?.ts || Date.now();
            const tsRange = Math.max(1, maxTs - minTs);
            const clampedTs = Math.max(minTs, Math.min(maxTs, cc.ts || minTs));
            const x = ((clampedTs - minTs) / tsRange) * 100;
            const isSelected = activeConfigDiff?.ts === cc.ts;

            return (
              <g
                key={`cfg-ev-${i}`}
                className="cursor-pointer group/marker"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveConfigDiff(isSelected ? null : cc);
                }}
                tabIndex={0}
                role="button"
                aria-label={`Config change at ${new Date(cc.ts).toLocaleTimeString()}: ${cc.label || 'Parameters updated'}. Click to view diff.`}
              >
                <line
                  x1={x} y1="0" x2={x} y2="100"
                  stroke="var(--color-amber)"
                  strokeWidth={isSelected ? "0.8" : "0.4"}
                  strokeDasharray="2,2"
                  className="opacity-80 group-hover/marker:opacity-100"
                />
              </g>
            );
          })}

          {/* Vertical Crosshair Guide Line */}
          {activePoint && (
            <line x1={activePoint.x} y1="0" x2={activePoint.x} y2="100" stroke="var(--color-accent)" strokeWidth="0.4" strokeDasharray="1.5,1.5" opacity="0.8" />
          )}
        </svg>

        {/* Perfectly Circular Crosshair Overlay Markers using CSS absolute positioning */}
        {activePoint && (
          <div className="absolute inset-0 pointer-events-none px-6 pb-4">
            {showPnl && (
              <div
                className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border border-surface shadow-md transition-all duration-75 flex items-center justify-center"
                style={{
                  left: `${activePoint.x}%`,
                  top: `${activePoint.yPnl}%`,
                  backgroundColor: activePoint.cumPnl >= 0 ? 'var(--color-green)' : 'var(--color-red)'
                }}
              >
                <div
                  className="w-5 h-5 -ml-1 -mt-1 rounded-full border animate-ping"
                  style={{ borderColor: activePoint.cumPnl >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}
                />
              </div>
            )}
            {showHitRate && (
              <div
                className="absolute w-2.5 h-2.5 -ml-1.25 -mt-1.25 rounded-full bg-accent border border-surface shadow-md transition-all duration-75"
                style={{
                  left: `${activePoint.x}%`,
                  top: `${activePoint.yHr}%`
                }}
              />
            )}
            {showPf && (
              <div
                className="absolute w-2.5 h-2.5 -ml-1.25 -mt-1.25 rounded-full bg-purple-500 border border-surface shadow-md transition-all duration-75"
                style={{
                  left: `${activePoint.x}%`,
                  top: `${activePoint.yPf}%`
                }}
              />
            )}
            {showSharpe && (
              <div
                className="absolute w-2.5 h-2.5 -ml-1.25 -mt-1.25 rounded-full bg-amber border border-surface shadow-md transition-all duration-75"
                style={{
                  left: `${activePoint.x}%`,
                  top: `${activePoint.ySharpe}%`
                }}
              />
            )}
            {showSortino && (
              <div
                className="absolute w-2.5 h-2.5 -ml-1.25 -mt-1.25 rounded-full bg-cyan-400 border border-surface shadow-md transition-all duration-75"
                style={{
                  left: `${activePoint.x}%`,
                  top: `${activePoint.ySortino}%`
                }}
              />
            )}
          </div>
        )}

        {/* Rich Hover Floating Tooltip */}
        {hoverData && (
          <div
            className="absolute top-2 z-30 bg-surface/95 border border-border/80 backdrop-blur-md p-2.5 rounded-xl shadow-2xl flex flex-col gap-1 text-[10.5px] font-mono pointer-events-none transition-all duration-75"
            style={{
              left: hoverData.x > 60 ? 'auto' : `${Math.max(2, hoverData.x + 2)}%`,
              right: hoverData.x > 60 ? `${Math.max(2, 100 - hoverData.x + 2)}%` : 'auto'
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/30 pb-1 font-bold">
              <span className="text-text">Trade #{hoverData.tradeIndex}</span>
              <span className="text-accent">{hoverData.symbol} ({hoverData.direction})</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-0.5">
              <div>
                <span className="text-dim text-[9px]">Entry: </span>
                <span className="text-text font-bold">${hoverData.entryPrice ? hoverData.entryPrice.toLocaleString() : '---'}</span>
              </div>
              <div>
                <span className="text-dim text-[9px]">Exit: </span>
                <span className="text-text font-bold">${hoverData.exitPrice ? hoverData.exitPrice.toLocaleString() : '---'}</span>
              </div>
              <div>
                <span className="text-dim text-[9px]">P&L: </span>
                <span className={cn("font-bold", pnlClass(hoverData.pnl))}>{fmtUSD(hoverData.pnl)}</span>
              </div>
              <div>
                <span className="text-dim text-[9px]">Duration: </span>
                <span className="text-text font-bold">{hoverData.durationMs ? formatDuration(hoverData.durationMs) : '---'}</span>
              </div>
            </div>
            <div className="border-t border-border/20 pt-1 text-[9px] text-dim flex items-center justify-between">
              <span>Strategy: <span className="text-text font-semibold">{hoverData.strategy}</span></span>
              <span>Cum PnL: <span className={cn("font-bold", pnlClass(hoverData.cumPnl))}>{fmtUSD(hoverData.cumPnl)}</span></span>
            </div>
          </div>
        )}
      </div>

      {/* Draggable Mini Range Brush Slider Underneath Chart */}
      {sortedRawTrades.length >= 2 && (
        <div className="flex flex-col gap-1 px-1">
          <div
            ref={brushRef}
            className="relative h-4 bg-surface/40 border border-border/30 rounded-md overflow-hidden cursor-pointer"
            onMouseDown={(e) => handleBrushMouseDown(e, 'move')}
          >
            {/* Background Mini Path representation */}
            <div className="absolute inset-0 opacity-20 bg-accent/20" />

            {/* Selected Range Overlay Window */}
            <div
              className="absolute top-0 bottom-0 bg-accent/25 border-x-2 border-accent transition-none"
              style={{
                left: `${rangeSpan[0]}%`,
                width: `${rangeSpan[1] - rangeSpan[0]}%`
              }}
            >
              {/* Left Handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-2.5 bg-accent/80 hover:bg-accent cursor-ew-resize flex items-center justify-center"
                onMouseDown={(e) => handleBrushMouseDown(e, 'left')}
              >
                <div className="w-0.5 h-2 bg-background rounded-full" />
              </div>
              {/* Right Handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-2.5 bg-accent/80 hover:bg-accent cursor-ew-resize flex items-center justify-center"
                onMouseDown={(e) => handleBrushMouseDown(e, 'right')}
              >
                <div className="w-0.5 h-2 bg-background rounded-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Adaptive X-Axis Labels (Max 8-12 ticks, Non-overlapping) */}
      {adaptiveTicks.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-0.5 text-[8.5px] font-mono text-dim/70 relative">
          {adaptiveTicks.map((tick, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === adaptiveTicks.length - 1;

            return (
              <div
                key={idx}
                className={cn(
                  "flex flex-col gap-0.5 transition-colors duration-150",
                  isFirst && "items-start text-left",
                  isLast && "items-end text-right",
                  !isFirst && !isLast && "items-center text-center"
                )}
              >
                <span className="font-bold text-[8.5px] text-text/70">
                  {tick.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Config Diff Details Popover */}
      {activeConfigDiff && (
        <div className="bg-surface/95 border border-amber/40 p-3 rounded-xl shadow-xl flex flex-col gap-2 text-xs font-mono text-left animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-amber/20 pb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
              <span className="font-black uppercase tracking-wider text-amber">
                ⚙️ {activeConfigDiff.label || 'Strategy Config Updated'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveConfigDiff(null)}
              className="text-dim hover:text-text p-0.5 rounded transition-colors"
              aria-label="Close diff details"
            >
              <X size={12} />
            </button>
          </div>
          <div className="text-[10px] text-dim/80 font-bold uppercase">
            {activeConfigDiff.ts ? new Date(activeConfigDiff.ts).toLocaleString() : 'Recent Update'}
          </div>
          <div className="flex flex-col gap-1 pt-1">
            {(Array.isArray(activeConfigDiff.diffs) ? activeConfigDiff.diffs : [activeConfigDiff.message || 'Parameters synchronized']).map((d, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[11px] font-bold text-text bg-background/50 px-2 py-1 rounded border border-border/30">
                <span className="text-amber">•</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const HitRateTrend = ({ trades = [], height = 180 }) => {
  const containerRef = useRef(null);
  const [hoverData, setHoverData] = useState(null);

  const { points, viewMin, viewMax, viewRange } = useMemo(() => {
    const rawTrades = Array.isArray(trades) ? trades : [];
    if (rawTrades.length < 2) return { points: [], viewMin: 0, viewMax: 100, viewRange: 100 };

    const count = rawTrades.length;
    const safeTrades = new Array(count);
    for (let i = 0; i < count; i++) {
      const t = rawTrades[i];
      const exitTs = t?.exit_ts_ms !== undefined ? t.exit_ts_ms : (t?.exit_ts || t?.createdAt ? new Date(t.exit_ts || t.createdAt).getTime() : 0);
      safeTrades[i] = { trade: t, exitTs };
    }

    let isSortedAsc = true;
    let isSortedDesc = true;
    for (let i = 1; i < count; i++) {
      const current = safeTrades[i].exitTs;
      const prev = safeTrades[i - 1].exitTs;
      if (current < prev) isSortedAsc = false;
      if (current > prev) isSortedDesc = false;
    }

    if (isSortedDesc) {
      safeTrades.reverse();
    } else if (!isSortedAsc) {
      safeTrades.sort((a, b) => a.exitTs - b.exitTs);
    }

    let totalWins = 0;
    const rollingData = safeTrades.map(({ trade: t }, idx) => {
      const isWin = Number(t?.pnl || 0) > 0;
      if (isWin) totalWins++;
      const currentHitRate = (totalWins / (idx + 1)) * 100;
      return {
        tradeIndex: idx + 1,
        hitRate: currentHitRate,
        pnl: Number(t?.pnl || 0),
        symbol: t?.symbol,
        ts: t?.exit_ts_ms || (t?.exit_ts ? new Date(t.exit_ts).getTime() : 0)
      };
    });

    const values = rollingData.map(d => d.hitRate);
    const min = Math.max(0, Math.min(...values) - 5);
    const max = Math.min(100, Math.max(...values) + 5);
    const range = Math.max(10, max - min);

    const pts = rollingData.map((d, i) => {
      const x = (i / (rollingData.length - 1)) * 100;
      const y = 100 - ((d.hitRate - min) / range) * 100;
      return { x, y, hitRate: d.hitRate, tradeIndex: d.tradeIndex, symbol: d.symbol, pnl: d.pnl, ts: d.ts };
    });

    return { points: pts, viewMin: min, viewMax: max, viewRange: range };
  }, [trades]);

  const pathD = useMemo(() => solveSmoothing(points), [points]);

  const handleInteraction = (clientX) => {
    if (!containerRef.current || points.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = ((clientX - rect.left) / rect.width) * 100;

    let closest = points[0];
    let minDiff = Math.abs(points[0].x - xPct);

    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].x - xPct);
      if (diff < minDiff) {
        minDiff = diff;
        closest = points[i];
      }
    }
    setHoverData(closest);
  };

  if (!trades || trades.length < 2) {
    return (
      <div style={{ height: `${height}px` }} className="flex flex-col items-center justify-center bg-surface/20 border border-border/40 rounded-2xl border-dashed">
        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Insufficient Trade Data for Hit Rate Trend</span>
      </div>
    );
  }

  const latestPoint = hoverData || points[points.length - 1];

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden select-none"
      style={{ height: `${height}px` }}
      onMouseMove={(e) => handleInteraction(e.clientX)}
      onTouchMove={(e) => e.touches[0] && handleInteraction(e.touches[0].clientX)}
      onMouseLeave={() => setHoverData(null)}
      role="region"
      aria-label={`Hit Rate Trend chart, latest value ${Number(latestPoint?.hitRate || 0).toFixed(1)}%.`}
    >
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-background/80 backdrop-blur-md px-2.5 py-1 rounded-xl border border-border/50 text-xs font-mono shadow-sm">
        <span className="text-dim text-[10px] uppercase tracking-wider font-sans font-bold">
          {hoverData ? `Trade #${hoverData.tradeIndex}` : 'Overall Hit Rate'}
        </span>
        <span className="font-bold text-accent">
          {Number(latestPoint?.hitRate || 0).toFixed(1)}%
        </span>
        {hoverData && (
          <span className={cn("text-[9px] font-mono", hoverData.pnl >= 0 ? "text-green" : "text-red")}>
            ({hoverData.symbol} {fmtUSD(hoverData.pnl)})
          </span>
        )}
      </div>

      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-[9px] font-mono text-dim/60">
        <span>50% Baseline</span>
      </div>

      <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line
          x1="0"
          y1={100 - ((50 - viewMin) / viewRange) * 100}
          x2="100"
          y2={100 - ((50 - viewMin) / viewRange) * 100}
          stroke="var(--color-border)"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />

        <path
          d={pathD}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {latestPoint && (
          <g>
            <line x1={latestPoint.x} y1="0" x2={latestPoint.x} y2="100" stroke="var(--color-accent)" strokeWidth="0.4" strokeDasharray="1,2" />
            <circle cx={latestPoint.x} cy={latestPoint.y} r="2.5" fill="var(--color-accent)" className="animate-pulse"  vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
    </div>
  );
};

export const TODPerformance = ({ data = [] }) => {
  const [hoverData, setHoverData] = useState(null);
  const [hoverHour, setHoverHour] = useState(null);
  const containerRef = useRef(null);

  // BOLT OPTIMIZATION: Single-pass loop-fused data aggregation for TODPerformance
  // Consolidates filtering, max PnL lookup, and average positive/negative PnL calculations
  // into a single traversal, eliminating intermediate array allocations (.filter(), .map()).
  const { validData, maxPnl, avgPos, avgNeg } = useMemo(() => {
    const safeData = Array.isArray(data) ? data : [];
    const valid = [];
    let max = 1;
    let posSum = 0;
    let posCount = 0;
    let negSum = 0;
    let negCount = 0;

    const len = safeData.length;
    for (let i = 0; i < len; i++) {
      const d = safeData[i];
      if (d && typeof d.pnl === 'number' && !isNaN(d.pnl)) {
        valid.push(d);
        const absPnl = Math.abs(d.pnl);
        if (absPnl > max) {
          max = absPnl;
        }
        if (d.pnl > 0) {
          posSum += d.pnl;
          posCount++;
        } else if (d.pnl < 0) {
          negSum += absPnl;
          negCount++;
        }
      }
    }

    return {
      validData: valid,
      maxPnl: max,
      avgPos: posCount > 0 ? posSum / posCount : 0,
      avgNeg: negCount > 0 ? negSum / negCount : 0
    };
  }, [data]);

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
               vectorEffect="non-scaling-stroke" />
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
