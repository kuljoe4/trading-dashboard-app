import React from 'react';
import { Activity, Zap, Leaf } from 'lucide-react';
import { cn, PulseDot, Tooltip } from './ui/primitives';

export const SystemMetric = ({ icon: Icon, label, value, colorClass, compact = false }) => (
  <div className={cn("flex items-center gap-2", compact ? "px-2" : "gap-3")}>
    <Icon size={compact ? 12 : 14} className={cn("shrink-0", colorClass || "text-dim")} />
    <div className={cn("flex items-baseline gap-2 min-w-0", compact ? "text-[10px]" : "flex-1 justify-between text-[11px]")}>
      {!compact && <span className="text-dim font-bold uppercase tracking-wider truncate">{label}</span>}
      <span className={cn("font-mono font-bold shrink-0", colorClass || "text-text")}>{value}</span>
    </div>
  </div>
);

export const SystemMetrics = ({ monitoring, rateLimit, rateLimitLastSync, wsStatus, gateState, isEcoMode, compact = false }) => (
  <div className={cn("flex items-center gap-4 overflow-hidden", compact ? "justify-center" : "flex-col")}>
    <div className="flex items-center gap-2">
      <div className={cn("flex items-center gap-2 overflow-hidden", compact ? "" : "p-3 bg-background/40 rounded-xl border border-border/50")}>
        <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
        {!compact && (
          <div className="flex flex-col">
            <span className={cn("font-bold uppercase tracking-widest truncate", wsStatus === 'live' ? "text-green" : "text-amber", "text-[10px]")}>
              {wsStatus === 'live' ? 'Live' : 'Offline'}
            </span>
            {(gateState === 'sleeping' || gateState === 'max_trades' || gateState === 'max_trades_period') && (
              <Tooltip
                side="right"
                content={gateState === 'sleeping'
                  ? "Sleep Mode: WebSockets closed. CPU usage reduced by >95%."
                  : "Gating Active: Momentum scanning paused. Main loop CPU reduced by ~90%."
                }
              >
                <span className="text-[8px] text-accent font-bold uppercase tracking-tight animate-pulse cursor-help">Efficiency Active</span>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {isEcoMode && !compact && (
        <div className="flex items-center gap-1.5 px-3 py-3 bg-green/10 rounded-xl border border-green/20 text-green text-[10px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-left-2">
          <Leaf size={12} fill="currentColor" /> ECO
        </div>
      )}
    </div>
    
    <Tooltip
      side={compact ? "right" : "top"}
      content={
        <div className="flex flex-col gap-1 p-0.5">
          <div className="font-bold border-b border-border/50 pb-1 mb-1 uppercase tracking-widest text-[9px]">Binance API Weight</div>
          <div className="flex justify-between gap-6">
            <span className="text-dim">Used (1m):</span>
            <span>{rateLimit?.used_weight_1m ?? 0}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-dim">Limit:</span>
            <span>{rateLimit?.limit ?? 1200}</span>
          </div>
          {rateLimitLastSync && (
            <div className="flex justify-between gap-6 mt-1 pt-1 border-t border-border/30">
              <span className="text-dim">Last Sync:</span>
              <span className="text-accent">{new Date(rateLimitLastSync).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          )}
        </div>
      }
    >
      <div className="w-full cursor-help">
        <SystemMetric
          icon={Activity}
          label="Rate"
          value={rateLimit ? `${rateLimit.used_weight_1m}/${rateLimit.limit}` : '---/---'}
          colorClass={rateLimit ? (rateLimit.used_weight_1m > rateLimit.limit * 0.8 ? "text-red" : rateLimit.used_weight_1m > rateLimit.limit * 0.5 ? "text-amber" : "text-green") : "text-dim"}
          compact={compact}
        />
      </div>
    </Tooltip>

    <>
      <SystemMetric
        icon={Zap}
        label="REST API"
        value={monitoring?.application?.api_requests_total ?? '---'}
        colorClass="text-accent"
        compact={compact}
      />
      {!compact && (
        <>
          <SystemMetric
            icon={Activity}
            label="Hot Loop"
            value={monitoring?.application ? `${monitoring.application.hot_loop_ms}ms` : '---ms'}
            colorClass={monitoring?.application?.hot_loop_ms > 100 ? "text-red" : "text-dim"}
            compact={compact}
          />
          <SystemMetric
            icon={Activity}
            label="Main Loop"
            value={monitoring?.application ? `${monitoring.application.main_loop_ms}ms` : '---ms'}
            colorClass={monitoring?.application?.main_loop_ms > 500 ? "text-red" : "text-dim"}
            compact={compact}
          />
        </>
      )}
    </>

  </div>
);
