import React from 'react';
import { Activity, Zap, Leaf, ShieldAlert, Cpu, Rocket, Search, CheckCircle2 } from 'lucide-react';
import { cn, PulseDot, Tooltip } from './ui/primitives';
import { motion, AnimatePresence } from 'framer-motion';

export const SystemMetric = ({ icon: Icon, label, value, colorClass, compact = false }) => (
  <div className={cn("flex items-center gap-2", compact ? "px-2" : "gap-3")}>
    <Icon size={compact ? 12 : 14} className={cn("shrink-0", colorClass || "text-dim")} />
    <div className={cn("flex items-baseline gap-2 min-w-0", compact ? "text-[10px]" : "flex-1 justify-between text-[11px]")}>
      {!compact && <span className="text-dim font-bold uppercase tracking-wider truncate">{label}</span>}
      <span className={cn("font-mono font-bold shrink-0", colorClass || "text-text")}>{value}</span>
    </div>
  </div>
);

const LoopVisualizer = ({ pipeline }) => {
  if (!pipeline || pipeline.stage === 'IDLE') return (
    <div className="flex items-center gap-2 text-[9px] text-dim/40 font-black uppercase tracking-[0.2em] italic">
       <Cpu size={10} className="opacity-20" /> Engine Idling
    </div>
  );

  const stages = [
    { key: 'SCANNING', label: 'Scan', icon: Search },
    { key: 'EVALUATING', label: 'Eval', icon: Activity },
    { key: 'RISK_CHECK', label: 'Risk', icon: ShieldAlert },
    { key: 'EXECUTING', label: 'Exec', icon: Rocket }
  ];

  const currentIdx = stages.findIndex(s => s.key === pipeline.stage);

  return (
    <div className="flex flex-col gap-2 w-full max-w-[200px]">
      <div className="flex justify-between items-center px-1">
        <span className="text-[8px] font-black text-accent uppercase tracking-widest flex items-center gap-1">
           <PulseDot color="bg-accent" /> {pipeline.stage}
        </span>
        {pipeline.symbol && (
           <span className="text-[8px] font-mono text-dim font-bold">{pipeline.symbol}</span>
        )}
      </div>
      <div className="flex items-center gap-1 h-1.5 w-full bg-white/5 rounded-full overflow-hidden p-0.5 border border-white/5">
        {stages.map((s, i) => {
          const isActive = i === currentIdx;
          const isPast = i < currentIdx;

          return (
            <div
              key={s.key}
              className={cn(
                "h-full rounded-full transition-all duration-300",
                isActive ? "flex-[2] bg-accent shadow-[0_0_8px_var(--color-accent)] animate-pulse" :
                isPast ? "flex-1 bg-green opacity-40" : "flex-1 bg-dim/20"
              )}
            />
          );
        })}
      </div>
    </div>
  );
};

export const SystemMetrics = ({ monitoring, rateLimit, rateLimitLastSync, wsStatus, gateState, isEcoMode, compact = false }) => (
  <div className={cn("flex items-center gap-4 overflow-hidden", compact ? "justify-center" : "flex-col w-full")}>
    <div className="flex items-center gap-2">
      <div className={cn("flex items-center gap-2 overflow-hidden", compact ? "" : "p-3 bg-background/40 rounded-xl border border-border/50")}>
        <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
        {!compact && (
          <div className="flex flex-col">
            <span className={cn("font-bold uppercase tracking-widest truncate", wsStatus === 'live' ? "text-green" : "text-amber", "text-[10px]")}>
              {wsStatus === 'live' ? 'Live' : 'Offline'}
            </span>
            {(gateState === 'sleeping' || gateState === 'max_trades' || gateState === 'max_trades_period') && (
              <span className="text-[8px] text-accent font-bold uppercase tracking-tight animate-pulse">Efficiency Active</span>
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
      side={compact ? "bottom" : "top"}
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
      {!compact && (
        <div className="w-full mt-4 pt-4 border-t border-border/50 flex flex-col gap-4">
           <div className="text-[9px] text-dim font-black uppercase tracking-[0.2em] mb-1">Pipeline Health</div>
           <LoopVisualizer pipeline={monitoring?.application?.loop_pipeline} />

           <div className="grid grid-cols-2 gap-4 mt-2">
              <SystemMetric
                icon={Zap}
                label="Calls"
                value={monitoring?.application?.api_requests_total ?? '---'}
                colorClass="text-accent"
                compact={compact}
              />
              <SystemMetric
                icon={CheckCircle2}
                label="UDS"
                value={monitoring?.application?.exchange_uds_status === 'CONNECTED' ? 'Live' : 'Stall'}
                colorClass={monitoring?.application?.exchange_uds_status === 'CONNECTED' ? "text-green" : "text-red"}
                compact={compact}
              />
           </div>

           <div className="space-y-2 mt-1">
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
           </div>
        </div>
      )}

      {compact && (
        <div className="flex items-center gap-3">
          <SystemMetric
            icon={Zap}
            label="REST"
            value={monitoring?.application?.api_requests_total ?? '---'}
            colorClass="text-accent"
            compact={compact}
          />
          <div className="w-px h-3 bg-border/50" />
          <div className="flex items-center">
             <PulseDot color={monitoring?.application?.exchange_uds_status === 'CONNECTED' ? "bg-green" : "bg-red"} />
          </div>
        </div>
      )}
    </>

  </div>
);
