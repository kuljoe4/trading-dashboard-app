import React from 'react';
import { Activity, Zap, Leaf, ShieldAlert, Cpu, Rocket, Search, CheckCircle2, Copy, Check } from 'lucide-react';
import { cn, PulseDot, Tooltip, Btn } from './ui/primitives';
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

export const SystemMetrics = ({ monitoring, rateLimit, rateLimitLastSync, wsStatus, gateState, isEcoMode, activeTrades = [], config = {}, compact = false }) => {
  const [copiedDiag, setCopiedDiag] = React.useState(false);

  const handleCopyDiagnostics = React.useCallback(async () => {
    try {
      const breakdown = monitoring?.application?.api_requests_breakdown || {};
      const logs = monitoring?.application?.rest_telemetry_logs || [];
      const app = monitoring?.application || {};

      const diagSnippet = [
        `### REST API Telemetry & Diagnostic Snippet`,
        `**Timestamp:** ${new Date().toISOString()}`,
        `**Trading Mode:** ${config?.trading_mode || (config?.paper_mode ? 'paper' : 'live')}`,
        `**WS Status:** ${wsStatus}`,
        `**API Weight:** ${rateLimit?.used_weight_1m ?? 0} / ${rateLimit?.limit ?? 2400}`,
        `**Total REST Calls:** ${app.api_requests_total ?? 0}`,
        `**Active Positions:** ${activeTrades.length}`,
        `**Watchlist Size:** ${config?.symbols?.length || 0}`,
        ``,
        `#### Endpoint Request Breakdown:`,
        Object.entries(breakdown).map(([label, cnt]) => `- \`${label}\`: ${cnt}`).join('\n') || '- None recorded',
        ``,
        `#### Recent REST Call Telemetry Logs:`,
        logs.map(l => `- [${new Date(l.ts).toISOString().substring(11, 19)}] \`${l.label}\` | ${l.duration}ms | W:${l.weight} | Status: ${l.status.toUpperCase()}${l.errorMsg ? ` (${l.errorMsg})` : ''}`).join('\n') || '- No recent logs'
      ].join('\n');

      await navigator.clipboard.writeText(diagSnippet);
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 2000);
    } catch (e) {
      console.error('Failed to copy diagnostics snippet', e);
    }
  }, [monitoring, rateLimit, wsStatus, config, activeTrades]);

  return (
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
              <span className="text-accent">{new Date(rateLimitLastSync).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      }
    >
      <div
        tabIndex={0}
        role="region"
        aria-label={`Binance API Weight: ${rateLimit ? `${rateLimit.used_weight_1m} of ${rateLimit.limit} used` : 'Unknown'}`}
        className="w-full cursor-help rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none p-0.5"
      >
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

           {/* Ultra-Dense Endpoint Breakdown Badges */}
           {monitoring?.application?.api_requests_breakdown && Object.keys(monitoring.application.api_requests_breakdown).length > 0 && (
             <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
               <div className="flex items-center justify-between">
                 <span className="text-[8px] font-black text-dim uppercase tracking-widest">REST Call Distribution</span>
                 <Tooltip content="Copy detailed diagnostic telemetry snippet to clipboard">
                   <Btn
                     variant="ghost"
                     onClick={handleCopyDiagnostics}
                     className="px-1.5 py-0.5 text-[8px] font-bold border border-border/50 hover:border-accent/40 text-dim hover:text-accent flex items-center gap-1 shrink-0"
                   >
                     {copiedDiag ? <Check size={9} className="text-green" /> : <Copy size={9} />}
                     {copiedDiag ? "Copied" : "Copy Diag"}
                   </Btn>
                 </Tooltip>
               </div>
               <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1 text-[9px] font-mono">
                 {Object.entries(monitoring.application.api_requests_breakdown).map(([label, count]) => (
                   <span key={label} className="px-1.5 py-0.5 rounded bg-surface border border-border/60 text-text/80 flex items-center gap-1">
                     <span className="text-accent font-bold">{count}</span>
                     <span className="truncate max-w-[90px]" title={label}>{label}</span>
                   </span>
                 ))}
               </div>
             </div>
           )}

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

           <div className="flex flex-col gap-2 mt-1">
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
};
