import React from 'react';
import { Activity, Cpu, HardDrive, Clock, Zap, Leaf } from 'lucide-react';
import { cn, PulseDot } from './ui/primitives';

export const SystemMetric = ({ icon: Icon, label, value, colorClass, compact = false }) => (
  <div className={cn("flex items-center gap-2", compact ? "px-2" : "gap-3")}>
    <Icon size={compact ? 12 : 14} className={cn("shrink-0", colorClass || "text-dim")} />
    <div className={cn("flex items-baseline gap-2 min-w-0", compact ? "text-[10px]" : "flex-1 justify-between text-[11px]")}>
      {!compact && <span className="text-dim font-bold uppercase tracking-wider truncate">{label}</span>}
      <span className={cn("font-mono font-bold shrink-0", colorClass || "text-text")}>{value}</span>
    </div>
  </div>
);

export const SystemMetrics = ({ monitoring, rateLimit, wsStatus, isEcoMode, compact = false }) => (
  <div className={cn("flex items-center gap-4 overflow-hidden", compact ? "justify-center" : "flex-col")}>
    <div className="flex items-center gap-2">
      <div className={cn("flex items-center gap-2 overflow-hidden", compact ? "" : "p-3 bg-background/40 rounded-xl border border-border/50")}>
        <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
        {!compact && (
          <span className={cn("font-bold uppercase tracking-widest truncate", wsStatus === 'live' ? "text-green" : "text-amber", "text-[10px]")}>
            {wsStatus === 'live' ? 'Live' : 'Offline'}
          </span>
        )}
      </div>

      {isEcoMode && !compact && (
        <div className="flex items-center gap-1.5 px-3 py-3 bg-green/10 rounded-xl border border-green/20 text-green text-[10px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-left-2">
          <Leaf size={12} fill="currentColor" /> ECO
        </div>
      )}
    </div>
    
    {rateLimit && (
      <SystemMetric
        icon={Activity}
        label="Rate"
        value={`${rateLimit.used_weight_1m}/${rateLimit.limit}`}
        colorClass={rateLimit.used_weight_1m > rateLimit.limit * 0.8 ? "text-red" : rateLimit.used_weight_1m > rateLimit.limit * 0.5 ? "text-amber" : "text-green"}
        compact={compact}
      />
    )}

    {monitoring?.application && (
      <SystemMetric
        icon={Zap}
        label="REST API"
        value={monitoring.application.api_requests_total}
        colorClass="text-accent"
        compact={compact}
      />
    )}

    {!compact && (
      <>
        {monitoring?.system && (
          <>
            <SystemMetric
              icon={Cpu}
              label="CPU"
              value={`${monitoring.system.cpu_usage}%`}
              colorClass={monitoring.system.cpu_usage > 50 ? "text-red" : "text-amber"}
              compact={compact}
            />
            <SystemMetric
              icon={Clock}
              label="Lag"
              value={`${monitoring.system.event_loop_lag}ms`}
              colorClass={monitoring.system.event_loop_lag > 50 ? "text-red" : "text-green"}
              compact={compact}
            />
          </>
        )}
      </>
    )}
  </div>
);
