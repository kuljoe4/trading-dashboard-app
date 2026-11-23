import React from 'react';
import { Drawer } from 'vaul';
import { Activity, Zap, Leaf, ShieldAlert, Cpu, Rocket, Search, CheckCircle2, Copy, Check, Info, X, Filter, Database, Server, Globe, Radio, RefreshCw, Clock, ShieldX } from 'lucide-react';
import { cn, PulseDot, Tooltip, Btn, VisuallyHidden } from './ui/primitives';
import { healthAPI, sessionAPI } from '../api/client';
import { useTradingStore } from '../store/trading';

const SignalBars = React.memo(({ latency }) => {
  if (latency === null || latency === undefined) {
    return (
      <div className="flex items-end gap-0.5 h-3 opacity-30 shrink-0" title="Latency Unknown">
        <div className="w-0.5 h-1 bg-dim rounded-xs" />
        <div className="w-0.5 h-1.5 bg-dim rounded-xs" />
        <div className="w-0.5 h-2 bg-dim rounded-xs" />
        <div className="w-0.5 h-2.5 bg-dim rounded-xs" />
      </div>
    );
  }

  const bars = latency < 60 ? 4 : latency < 120 ? 3 : latency < 250 ? 2 : 1;
  const barColor = latency < 120 ? "bg-green shadow-[0_0_4px_rgba(34,197,94,0.6)]" : latency < 250 ? "bg-amber shadow-[0_0_4px_rgba(245,158,11,0.6)]" : "bg-red shadow-[0_0_4px_rgba(239,68,68,0.6)]";

  return (
    <div className="flex items-end gap-0.5 h-3 shrink-0" title={`Latency: ${latency}ms`}>
      <div className={cn("w-0.5 rounded-xs transition-all", bars >= 1 ? barColor : "bg-white/10", "h-1")} />
      <div className={cn("w-0.5 rounded-xs transition-all", bars >= 2 ? barColor : "bg-white/10", "h-1.5")} />
      <div className={cn("w-0.5 rounded-xs transition-all", bars >= 3 ? barColor : "bg-white/10", "h-2")} />
      <div className={cn("w-0.5 rounded-xs transition-all", bars >= 4 ? barColor : "bg-white/10", "h-2.5")} />
    </div>
  );
});
SignalBars.displayName = 'SignalBars';

// Shared singleton probe state so Sidebar + MobileHealthBar do not duplicate /health/binance calls
const sharedHealthState = {
  data: null,
  lastProbeTs: null,
  loading: false,
  inFlight: null,
  subscribers: new Set(),
  pollTimer: null,
};

function notifyHealthSubscribers() {
  const snapshot = {
    healthData: sharedHealthState.data,
    lastProbeTs: sharedHealthState.lastProbeTs,
    probeLoading: sharedHealthState.loading,
  };
  sharedHealthState.subscribers.forEach(cb => cb(snapshot));
}

async function runSharedHealthProbe(fresh = false) {
  if (sharedHealthState.inFlight) return sharedHealthState.inFlight;
  sharedHealthState.loading = true;
  notifyHealthSubscribers();
  sharedHealthState.inFlight = (async () => {
    try {
      const res = await healthAPI.getBinanceHealth(fresh);
      if (res && res.data) {
        sharedHealthState.data = res.data;
        sharedHealthState.lastProbeTs = Date.now();
      }
    } catch (err) {
      console.warn('Failed to fetch Binance health probe:', err);
    } finally {
      sharedHealthState.loading = false;
      sharedHealthState.inFlight = null;
      notifyHealthSubscribers();
    }
  })();
  return sharedHealthState.inFlight;
}

function useSharedBinanceHealth() {
  const [state, setState] = React.useState(() => ({
    healthData: sharedHealthState.data,
    lastProbeTs: sharedHealthState.lastProbeTs,
    probeLoading: sharedHealthState.loading,
  }));

  React.useEffect(() => {
    sharedHealthState.subscribers.add(setState);
    if (!sharedHealthState.data && !sharedHealthState.inFlight) {
      runSharedHealthProbe(false);
    }
    if (!sharedHealthState.pollTimer) {
      sharedHealthState.pollTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          runSharedHealthProbe(false);
        }
      }, 120000);
    }
    return () => {
      sharedHealthState.subscribers.delete(setState);
      if (sharedHealthState.subscribers.size === 0 && sharedHealthState.pollTimer) {
        clearInterval(sharedHealthState.pollTimer);
        sharedHealthState.pollTimer = null;
      }
    };
  }, []);

  return { ...state, fetchHealth: runSharedHealthProbe };
}

function formatBanCountdown(ms) {
  if (ms <= 0) return { text: 'Lifted', expired: true };
  const totalSecs = Math.floor(ms / 1000);
  const days = Math.floor(totalSecs / (24 * 3600));
  const hours = Math.floor((totalSecs % (24 * 3600)) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${String(hours).padStart(days > 0 ? 2 : 1, '0')}h`);
  parts.push(`${String(mins).padStart(hours > 0 || days > 0 ? 2 : 1, '0')}m`);
  parts.push(`${String(secs).padStart(2, '0')}s`);
  return { text: parts.join(' '), expired: false };
}

export const SystemMetric = ({ icon: Icon, label, value, colorClass, compact = false }) => (
  <div className={cn("flex items-center gap-2", compact ? "px-1.5 gap-1.5" : "gap-3")}>
    <Icon size={compact ? 12 : 14} className={cn("shrink-0", colorClass || "text-dim")} />
    <div className={cn("flex items-baseline gap-1.5 min-w-0", compact ? "text-[10px]" : "flex-1 justify-between text-[11px]")}>
      {!compact && <span className="text-dim font-bold uppercase tracking-wider truncate">{label}</span>}
      <span className={cn("font-mono font-bold shrink-0 tabular-nums", colorClass || "text-text")}>{value}</span>
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

export const SystemMetrics = ({ monitoring, rateLimit, rateLimitLastSync, apiStatus, wsStatus, gateState, isEcoMode, activeTrades = [], config = {}, compact = false }) => {
  const [copiedDiag, setCopiedDiag] = React.useState(false);
  const [isMobileDiagOpen, setIsMobileDiagOpen] = React.useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = React.useState('all');
  const [selectedStatus, setSelectedStatus] = React.useState('all');
  const [now, setNow] = React.useState(() => Date.now());
  const { healthData, lastProbeTs, probeLoading, fetchHealth } = useSharedBinanceHealth();

  const banUntilMs = apiStatus?.banUntil
    ? new Date(apiStatus.banUntil).getTime()
    : (healthData?.ip_status?.ban_until ? Number(healthData.ip_status.ban_until) : null);
  const isBanned = apiStatus?.isBanned || healthData?.ip_status?.is_banned || false;
  const isGeoBlocked = apiStatus?.isGeoBlocked || healthData?.geo_restricted || false;

  React.useEffect(() => {
    if (!banUntilMs && !isBanned) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [banUntilMs, isBanned]);

  const msRemaining = banUntilMs ? Math.max(0, banUntilMs - now) : 0;
  const banCountdown = formatBanCountdown(msRemaining);

  const liveLatency = healthData?.live?.latency_ms ?? null;
  const testnetLatency = healthData?.testnet?.latency_ms ?? null;
  const pingColor = liveLatency === null ? "text-dim" : liveLatency < 80 ? "text-green" : liveLatency < 180 ? "text-amber" : "text-red";

  const app = monitoring?.application || {};
  const udsStatus = healthData?.uds_status || app.exchange_uds_status || (wsStatus === 'live' ? 'CONNECTED' : 'DISCONNECTED');
  const breakdown = app.api_requests_breakdown || {};
  const rawLogs = app.rest_telemetry_logs || [];
  const cacheMetrics = app.cache_metrics || { hit_ratio_pct: 100, hits_total: 0, misses_total: 0, breakdown: {} };
  const resourceFootprints = app.resource_footprints || { heap_used_mb: 0, heap_total_mb: 0, rss_mb: 0 };
  const recommendations = app.recommendations || [];
  const telemetryEnabled = app.telemetry_enabled !== false && config?.track_binance_rate_limits !== false;

  const endpointOptions = React.useMemo(() => {
    return ['all', ...Object.keys(breakdown)];
  }, [breakdown]);

  const filteredLogs = React.useMemo(() => {
    return rawLogs.filter(log => {
      const matchEndpoint = selectedEndpoint === 'all' || log.label === selectedEndpoint;
      const matchStatus = selectedStatus === 'all' || log.status === selectedStatus;
      return matchEndpoint && matchStatus;
    });
  }, [rawLogs, selectedEndpoint, selectedStatus]);

  const handleCopyDiagnostics = React.useCallback(async () => {
    try {
      const diagSnippet = [
        `### REST API Telemetry & Diagnostic Snippet`,
        `**Timestamp:** ${new Date().toISOString()}`,
        `**Trading Mode:** ${config?.trading_mode || (config?.paper_mode ? 'paper' : 'live')}`,
        `**WS Status:** ${wsStatus}`,
        `**API Weight:** ${rateLimit?.used_weight_1m ?? 0} / ${rateLimit?.limit ?? 2400}`,
        `**Total REST Calls:** ${app.api_requests_total ?? 0} (Success Rate: ${app.api_success_rate_pct ?? 100}%)`,
        `**Cache Hit Ratio:** ${cacheMetrics.hit_ratio_pct}% (${cacheMetrics.hits_total} hits / ${cacheMetrics.misses_total} misses)`,
        `**Memory Footprint:** ${resourceFootprints.heap_used_mb || 0}MB used / ${resourceFootprints.heap_total_mb || 0}MB heap`,
        `**Active Positions:** ${activeTrades.length}`,
        `**Watchlist Size:** ${config?.symbols?.length || 0}`,
        ``,
        `#### Reconciliation & Audit Architecture:`,
        `- **Audit Strategy:** Smart Hybrid Mode (Bulk positionInformationV3 for N>=2 symbols [5 weight], Targeted open orders [2 weight/sym])`,
        `- **UDS Zero-Weight Audit:** ${wsStatus === 'live' ? 'ACTIVE (WebSocket cache used during steady-state trading; 0 REST weight)' : 'FALLBACK (REST polling active)'}`,
        `- **positionInformationV3:** Position Risk & Ground Truth Sync (Bulk 5 Weight)`,
        `- **currentAllOpenOrders:** Standard Open Orders Verification (1 Weight/sym)`,
        `- **currentAllAlgoOpenOrders:** Algorithmic & Conditional SL/TP Trigger Orders Verification (1 Weight/sym)`,
        ``,
        `#### Endpoint Request Breakdown:`,
        Object.entries(breakdown).map(([label, cnt]) => `- \`${label}\`: ${cnt}`).join('\n') || '- None recorded',
        ``,
        `#### SRE Recommendations:`,
        recommendations.map(r => `- ${r}`).join('\n') || '- System optimal',
        ``,
        `#### Recent REST Call Telemetry Logs:`,
        filteredLogs.map(l => `- [${new Date(l.ts).toISOString().substring(11, 19)}] \`${l.label}\` | ${l.duration}ms | W:${l.weight} | Status: ${l.status.toUpperCase()}${l.errorMsg ? ` (${l.errorMsg})` : ''}`).join('\n') || '- No matching logs'
      ].join('\n');

      await navigator.clipboard.writeText(diagSnippet);
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 2000);
    } catch (e) {
      console.error('Failed to copy diagnostics snippet', e);
    }
  }, [app, breakdown, rawLogs, filteredLogs, cacheMetrics, resourceFootprints, recommendations, rateLimit, wsStatus, config, activeTrades]);

  return (
  <div className={cn("flex items-center overflow-hidden", compact ? "justify-between w-full gap-2" : "flex-col w-full gap-4")}>
    <div className={cn("flex items-center gap-2 shrink-0", !compact && "w-full justify-between")}>
      <div className={cn("flex items-center gap-2 overflow-hidden", compact ? "" : "p-3 bg-background/40 rounded-xl border border-border/50")}>
        <PulseDot
          color={
            wsStatus === 'live'
              ? "bg-green"
              : wsStatus === 'reconnecting' || wsStatus === 'connecting'
              ? "bg-amber animate-pulse"
              : wsStatus === 'error'
              ? "bg-red-500 animate-ping"
              : "bg-dim/40"
          }
        />
        {!compact && (
          <div className="flex flex-col">
            <span
              className={cn(
                "font-bold uppercase tracking-widest truncate text-[10px]",
                wsStatus === 'live'
                  ? "text-green"
                  : wsStatus === 'reconnecting' || wsStatus === 'connecting'
                  ? "text-amber"
                  : wsStatus === 'error'
                  ? "text-red-400"
                  : "text-dim"
              )}
            >
              {wsStatus === 'live'
                ? 'Live'
                : wsStatus === 'reconnecting'
                ? 'Reconnecting'
                : wsStatus === 'connecting'
                ? 'Connecting'
                : wsStatus === 'error'
                ? 'Failed'
                : 'Offline'}
            </span>
            {(gateState === 'sleeping' || gateState === 'max_trades' || gateState === 'max_trades_period') && (
              <span className="text-[8px] text-accent font-bold uppercase tracking-tight animate-pulse">Efficiency Active</span>
            )}
          </div>
        )}
      </div>

      {!telemetryEnabled && !compact && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber/10 rounded-xl border border-amber/20 text-amber text-[9px] font-bold uppercase tracking-wider">
          <Database size={11} /> Paused
        </div>
      )}

      {isEcoMode && !compact && (
        <div className="flex items-center gap-1.5 px-3 py-3 bg-green/10 rounded-xl border border-green/20 text-green text-[10px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-left-2">
          <Leaf size={12} fill="currentColor" /> ECO
        </div>
      )}
    </div>
    
    <Tooltip
      side={compact ? "bottom" : "top"}
      content={
        <div className="flex flex-col gap-1.5 p-1 min-w-[210px]">
          <div className="flex items-center justify-between border-b border-border/50 pb-1 mb-0.5">
            <span className="font-bold uppercase tracking-widest text-[9px]">Binance API Weight</span>
            <Btn
              variant="ghost"
              onClick={handleCopyDiagnostics}
              className="px-1.5 py-0.5 text-[8px] font-bold border border-border/50 hover:border-accent/40 text-dim hover:text-accent flex items-center gap-1 shrink-0"
              aria-label="Copy Diagnostic Telemetry Snippet"
            >
              {copiedDiag ? <Check size={9} className="text-green" /> : <Copy size={9} />}
              {copiedDiag ? "Copied" : "Copy Diag"}
            </Btn>
          </div>
          <div className="flex justify-between gap-6 text-[10px]">
            <span className="text-dim">Used (1m):</span>
            <span className="font-mono font-bold">{rateLimit?.used_weight_1m ?? 0}</span>
          </div>
          <div className="flex justify-between gap-6 text-[10px]">
            <span className="text-dim">Limit:</span>
            <span className="font-mono">{rateLimit?.limit ?? 2400}</span>
          </div>
          <div className="flex justify-between gap-6 text-[10px] pt-1 border-t border-border/30">
            <span className="text-dim">Cache Hit Ratio:</span>
            <span className="font-mono text-green font-bold">{cacheMetrics.hit_ratio_pct}%</span>
          </div>
          {breakdown && Object.keys(breakdown).length > 0 && (
            <div className="mt-1 pt-1 border-t border-border/30 flex flex-col gap-1">
              <span className="text-[8px] font-black text-dim uppercase tracking-widest">Active REST Calls</span>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5 text-[8px] font-mono">
                {Object.entries(breakdown).map(([label, count]) => (
                  <span key={label} className="px-1 py-0.5 rounded bg-surface/80 border border-border/50 text-text/80 flex items-center gap-1">
                    <span className="text-accent font-bold">{count}</span>
                    <span className="truncate max-w-[85px]" title={label}>{label}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {rateLimitLastSync && (
            <div className="flex justify-between gap-6 mt-1 pt-1 border-t border-border/30 text-[9px]">
              <span className="text-dim">Last Sync:</span>
              <span className="text-accent font-mono">{new Date(rateLimitLastSync).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      }
    >
      <div
        tabIndex={0}
        role="region"
        aria-label={`Binance API Weight: ${rateLimit ? `${rateLimit.used_weight_1m ?? 0} of ${rateLimit.limit ?? 2400} used` : 'Unknown'}`}
        className="w-full cursor-help rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none p-0.5"
      >
        <SystemMetric
          icon={Activity}
          label="Rate"
          value={rateLimit ? `${rateLimit.used_weight_1m ?? 0}/${rateLimit.limit ?? 2400}` : '---/---'}
          colorClass={rateLimit ? ((rateLimit.used_weight_1m ?? 0) > (rateLimit.limit ?? 2400) * 0.8 ? "text-red" : (rateLimit.used_weight_1m ?? 0) > (rateLimit.limit ?? 2400) * 0.5 ? "text-amber" : "text-green") : "text-dim"}
          compact={compact}
        />
      </div>
    </Tooltip>

    <>
      {!compact && (
        <div className="w-full mt-2 pt-3 border-t border-border/50 flex flex-col gap-3">
           {/* Consolidated Binance Connectivity & Latency Strip (migrated from ApiHealthWidget) */}
           <div className={cn(
             "bg-surface/50 border rounded-xl p-2.5 flex flex-col gap-2 font-mono text-[9px]",
             (isBanned || isGeoBlocked) ? "border-red/40 bg-red/5" : "border-border/50"
           )}>
             <div className="flex items-center justify-between gap-1">
               <span className="text-[8px] font-black text-dim uppercase tracking-widest flex items-center gap-1">
                 <Globe size={10} className="text-accent" /> Binance Edge
               </span>
               <div className="flex items-center gap-1.5">
                 <span className={cn("text-[8px] font-black uppercase", udsStatus === 'CONNECTED' ? "text-green" : "text-red")}>
                   UDS {udsStatus === 'CONNECTED' ? 'LIVE' : 'OFF'}
                 </span>
                 <Tooltip content="Probe fresh Live & Testnet REST latency">
                   <button
                     type="button"
                     onClick={() => fetchHealth(true)}
                     disabled={probeLoading}
                     aria-label="Probe Fresh"
                     className="p-1 rounded border border-border/50 hover:border-accent/40 text-dim hover:text-accent transition-colors cursor-pointer"
                   >
                     <RefreshCw size={9} className={cn(probeLoading && "animate-spin text-accent")} />
                   </button>
                 </Tooltip>
               </div>
             </div>

             <div className="grid grid-cols-2 gap-2 text-[9px]">
               <div className="flex items-center justify-between gap-1 bg-background/50 px-2 py-1 rounded-lg border border-border/30">
                 <span className="text-dim">Live</span>
                 <div className="flex items-center gap-1">
                   <SignalBars latency={liveLatency} />
                   <span className={cn("font-bold tabular-nums", pingColor)}>
                     {liveLatency !== null ? `${liveLatency}ms` : '---'}
                   </span>
                 </div>
               </div>
               <div className="flex items-center justify-between gap-1 bg-background/50 px-2 py-1 rounded-lg border border-border/30">
                 <span className="text-dim">Testnet</span>
                 <span className="font-bold text-text tabular-nums">
                   {testnetLatency !== null ? `${testnetLatency}ms` : '---'}
                 </span>
               </div>
             </div>

             {(isBanned || isGeoBlocked || banUntilMs) && (
               <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-red/15 border border-red/30 text-red text-[8.5px]">
                 <span className="flex items-center gap-1 font-bold truncate tabular-nums whitespace-nowrap">
                   <ShieldX size={10} className="shrink-0" />
                   {isGeoBlocked ? 'Geo-Blocked' : !banCountdown.expired ? `Ban: ${banCountdown.text}` : 'Ban Lifted'}
                 </span>
                 {isBanned && (
                   <button
                     type="button"
                     onClick={async () => {
                       try {
                         await sessionAPI.clearBan();
                         useTradingStore.setState(st => ({
                           apiStatus: { ...st.apiStatus, isBanned: false, isRateLimited: false, banUntil: null }
                         }));
                         fetchHealth(true);
                       } catch (e) {
                         console.error('Failed to clear ban:', e);
                       }
                     }}
                     className="px-1.5 py-0.5 rounded bg-red/20 border border-red/30 font-black uppercase text-[7.5px] hover:bg-red/30 cursor-pointer shrink-0"
                   >
                     Clear
                   </button>
                 )}
               </div>
             )}
           </div>

           <div className="text-[9px] text-dim font-black uppercase tracking-[0.2em] mb-1">Pipeline Health</div>
           <LoopVisualizer pipeline={app.loop_pipeline} />

           {/* Cache Performance Visualization */}
           <div className="bg-surface/50 border border-border/50 rounded-xl p-2.5 flex flex-col gap-2">
             <div className="flex items-center justify-between">
               <span className="text-[8px] font-black text-dim uppercase tracking-widest flex items-center gap-1">
                 <Database size={10} className="text-accent" /> Cache Performance
               </span>
               <span className="font-mono text-[9px] font-bold text-green">
                 {cacheMetrics.hit_ratio_pct}% Hits ({cacheMetrics.hits_total}h / {cacheMetrics.misses_total}m)
               </span>
             </div>
             <div className="w-full bg-border/40 h-1.5 rounded-full overflow-hidden flex">
               <div className="bg-green h-full transition-all duration-500" style={{ width: `${cacheMetrics.hit_ratio_pct}%` }} />
               <div className="bg-amber/60 h-full transition-all duration-500" style={{ width: `${100 - cacheMetrics.hit_ratio_pct}%` }} />
             </div>
             {cacheMetrics.breakdown && Object.keys(cacheMetrics.breakdown).length > 0 && (
               <div className="flex flex-wrap gap-1 text-[8px] font-mono">
                 {Object.entries(cacheMetrics.breakdown).map(([domain, data]) => {
                   const tot = (data.hits || 0) + (data.misses || 0);
                   if (tot === 0) return null;
                   const ratio = Math.round(((data.hits || 0) / tot) * 100);
                   return (
                     <span key={domain} className="px-1.5 py-0.5 rounded bg-background border border-border/60 text-dim flex items-center gap-1">
                       <span className="text-text font-bold">{domain.replace(/_/g, ' ')}:</span>
                       <span className={ratio >= 90 ? "text-green" : "text-amber"}>{ratio}%</span>
                     </span>
                   );
                 })}
               </div>
             )}
           </div>

           {/* Filterable Endpoint Breakdown & Call Success Rates */}
           {breakdown && Object.keys(breakdown).length > 0 && (
             <div className="flex flex-col gap-2 pt-2 border-t border-border/30">
               <div className="flex items-center justify-between gap-2">
                 <span className="text-[10px] font-bold text-dim uppercase tracking-wider flex items-center gap-1.5">
                   <Filter size={11} className="text-accent" /> REST Call Filter
                 </span>
                 <Tooltip content="Copy detailed diagnostic telemetry snippet to clipboard">
                   <Btn
                     variant="ghost"
                     onClick={handleCopyDiagnostics}
                     className="min-h-[32px] sm:min-h-[24px] px-2.5 py-1 text-[10px] font-semibold border border-border/50 hover:border-accent/40 text-dim hover:text-accent flex items-center gap-1 shrink-0 rounded-lg"
                   >
                     {copiedDiag ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                     {copiedDiag ? "Copied" : "Copy Diag"}
                   </Btn>
                 </Tooltip>
               </div>

               {/* Endpoint Filter Chips */}
               <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                 {endpointOptions.map(ep => (
                   <button
                     key={ep}
                     type="button"
                     aria-pressed={selectedEndpoint === ep}
                     onClick={() => setSelectedEndpoint(ep)}
                     className={cn(
                       "min-h-[32px] sm:min-h-[24px] px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold uppercase tracking-tight shrink-0 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                       selectedEndpoint === ep
                         ? "bg-accent text-white shadow-xs"
                         : "bg-surface border border-border/60 text-dim hover:text-text"
                     )}
                   >
                     {ep === 'all' ? 'All Calls' : ep}
                   </button>
                 ))}
               </div>

               {/* Filtered Endpoint Counts */}
               <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1 text-[10.5px] font-mono">
                 {Object.entries(breakdown)
                   .filter(([label]) => selectedEndpoint === 'all' || label === selectedEndpoint)
                   .map(([label, count]) => (
                     <span key={label} className="px-2 py-1 rounded-lg bg-surface border border-border/60 text-text/85 flex items-center gap-1.5 tabular-nums">
                       <span className="text-accent font-bold">{count}</span>
                       <span className="truncate max-w-[120px]" title={label}>{label}</span>
                     </span>
                   ))}
               </div>
             </div>
           )}

           <div className="grid grid-cols-2 gap-4 mt-2">
              <SystemMetric
                icon={Zap}
                label="Calls"
                value={app.api_requests_total ?? '---'}
                colorClass="text-accent"
                compact={compact}
              />
              <SystemMetric
                icon={CheckCircle2}
                label="Success"
                value={app.api_success_rate_pct ? `${app.api_success_rate_pct}%` : '100%'}
                colorClass={app.api_success_rate_pct < 95 ? "text-amber" : "text-green"}
                compact={compact}
              />
           </div>

           {/* System Resource Footprints Audit Card */}
           <div className="bg-surface/40 border border-border/50 rounded-xl p-2.5 flex flex-col gap-1.5 font-mono text-[9px]">
             <div className="flex items-center justify-between text-[8px] font-black text-dim uppercase tracking-widest">
               <span className="flex items-center gap-1"><Server size={10} className="text-accent" /> Memory & Loops</span>
               <span className="text-text font-bold">{resourceFootprints.heap_used_mb || 0}MB / {resourceFootprints.heap_total_mb || 0}MB</span>
             </div>
             <div className="grid grid-cols-2 gap-2 text-dim">
               <div className="flex justify-between">
                 <span>Hot Loop:</span>
                 <span className={app.hot_loop_ms > 100 ? "text-red font-bold" : "text-text font-bold"}>{app.hot_loop_ms ?? 0}ms</span>
               </div>
               <div className="flex justify-between">
                 <span>Main Loop:</span>
                 <span className={app.main_loop_ms > 500 ? "text-red font-bold" : "text-text font-bold"}>{app.main_loop_ms ?? 0}ms</span>
               </div>
             </div>
           </div>

           {/* Automated SRE Recommendations */}
           {recommendations.length > 0 && (
             <div className="flex flex-col gap-1 pt-1 border-t border-border/30">
               <span className="text-[8px] font-black text-dim uppercase tracking-widest">SRE Guidance</span>
               <div className="flex flex-col gap-1">
                 {recommendations.slice(0, 3).map((rec, idx) => (
                   <span key={idx} className="text-[8px] text-dim/90 font-medium leading-tight flex items-start gap-1">
                     <span className="text-accent shrink-0">➔</span> {rec}
                   </span>
                 ))}
               </div>
             </div>
           )}
        </div>
      )}

      {compact && (
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
            <SignalBars latency={liveLatency} />
            <span className={cn("font-bold tabular-nums", pingColor)}>
              {liveLatency !== null ? `${liveLatency}ms` : '---'}
            </span>
          </div>
          <div className="w-px h-3 bg-border/50" />
          <SystemMetric
            icon={Zap}
            label="REST"
            value={app.api_requests_total ?? '---'}
            colorClass="text-accent"
            compact={compact}
          />
          <div className="w-px h-3 bg-border/50" />
          <div className="flex items-center gap-1.5 shrink-0">
             <span className={cn("text-[9px] font-mono font-bold uppercase hidden xs:inline", udsStatus === 'CONNECTED' ? "text-green" : "text-red")}>UDS</span>
             <PulseDot color={udsStatus === 'CONNECTED' ? "bg-green" : "bg-red"} />
             <button
               type="button"
               onClick={() => setIsMobileDiagOpen(true)}
               aria-label="Open mobile telemetry & diagnostic breakdown"
               className="p-1 rounded-md bg-surface border border-border/60 text-dim hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-colors cursor-pointer"
             >
               <Info size={12} />
             </button>
          </div>
        </div>
      )}
    </>

    {/* Mobile Diagnostic & Telemetry Drawer */}
    {compact && (
      <Drawer.Root open={isMobileDiagOpen} onOpenChange={setIsMobileDiagOpen} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]" />
          <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[28px] fixed inset-x-0 bottom-0 max-h-[85vh] z-[101] focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="p-2 bg-background rounded-t-[28px] flex flex-col items-center shrink-0 border-b border-border/40">
              <div className="w-12 h-1.5 bg-border rounded-full mb-2" />
              <div className="w-full flex items-center justify-between px-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text">
                  <Activity size={14} className="text-accent" /> System Telemetry & Diagnostics
                </div>
                <Drawer.Close asChild>
                  <button type="button" aria-label="Close telemetry drawer" className="p-1 rounded-lg hover:bg-surface text-dim hover:text-text transition-colors">
                    <X size={16} />
                  </button>
                </Drawer.Close>
              </div>
              <VisuallyHidden>
                <Drawer.Title>System Telemetry & Diagnostics</Drawer.Title>
                <Drawer.Description>Real-time REST call distribution, pipeline health, and diagnostic snippet exporter.</Drawer.Description>
              </VisuallyHidden>
            </div>

            <div className="p-4 overflow-y-auto flex flex-col gap-3.5 text-xs">
              <div className="flex items-center justify-between gap-2 p-3 bg-surface/50 border border-border/60 rounded-xl flex-wrap">
                <div className="flex items-center gap-2">
                  <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
                  <span className="font-bold uppercase tracking-wider text-[11px]">{wsStatus === 'live' ? 'WebSocket Live' : 'WebSocket Offline'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Btn variant="ghost" onClick={() => fetchHealth(true)} disabled={probeLoading} className="px-2 py-1 text-[10px] font-bold border border-border/60 bg-surface text-text flex items-center gap-1">
                    <RefreshCw size={10} className={cn(probeLoading && "animate-spin text-accent")} />
                    Probe Fresh
                  </Btn>
                  <Btn variant="ghost" onClick={handleCopyDiagnostics} className="px-2 py-1 text-[10px] font-bold border border-accent/30 bg-accent/10 text-accent flex items-center gap-1.5">
                    {copiedDiag ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                    {copiedDiag ? "Copied Snippet" : "Copy Diag Snippet"}
                  </Btn>
                </div>
              </div>

              {(isBanned || isGeoBlocked || banUntilMs) && (
                <div className="p-3 bg-red/15 border border-red/40 rounded-xl flex items-center justify-between gap-2 font-mono text-red">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock size={14} className="shrink-0" />
                    <span className="font-bold text-[10.5px] uppercase truncate tabular-nums whitespace-nowrap">
                      {isGeoBlocked ? 'Geo-Blocked (451)' : !banCountdown.expired ? `IP Ban Cooldown: ${banCountdown.text}` : 'IP Cooldown Completed'}
                    </span>
                  </div>
                  {isBanned && (
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await sessionAPI.clearBan();
                          useTradingStore.setState(st => ({
                            apiStatus: { ...st.apiStatus, isBanned: false, isRateLimited: false, banUntil: null }
                          }));
                          fetchHealth(true);
                        } catch (e) {
                          console.error('Failed to clear ban:', e);
                        }
                      }}
                      className="text-[9px] py-0.5 px-2 border-red/30 hover:bg-red/20 text-red shrink-0"
                    >
                      Clear Lock
                    </Btn>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 font-mono">
                <div className="p-2.5 bg-surface/30 border border-border/50 rounded-xl flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-dim uppercase tracking-wider flex items-center gap-1">
                    <Globe size={10} className="text-accent" /> Live REST Ping
                  </span>
                  <div className="flex items-center justify-between">
                    <span className={cn("text-sm font-black", pingColor)}>{liveLatency !== null ? `${liveLatency} ms` : '---'}</span>
                    <SignalBars latency={liveLatency} />
                  </div>
                </div>
                <div className="p-2.5 bg-surface/30 border border-border/50 rounded-xl flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-dim uppercase tracking-wider flex items-center gap-1">
                    <Radio size={10} className="text-accent" /> Account Stream
                  </span>
                  <span className={cn("text-sm font-black", udsStatus === 'CONNECTED' ? "text-green" : "text-red")}>
                    {udsStatus === 'CONNECTED' ? 'Zero-Weight UDS' : 'Offline'}
                  </span>
                </div>
                <div className="p-2.5 bg-surface/30 border border-border/50 rounded-xl flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-dim uppercase tracking-wider">Testnet Ping</span>
                  <span className="text-sm font-black text-text">{testnetLatency !== null ? `${testnetLatency} ms` : '---'}</span>
                </div>
                <div className="p-2.5 bg-surface/30 border border-border/50 rounded-xl flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-dim uppercase tracking-wider">API Weight 1M</span>
                  <span className="text-sm font-black text-text">{rateLimit?.used_weight_1m ?? 0} / {rateLimit?.limit ?? 2400}</span>
                </div>
              </div>

              <div className="p-2.5 bg-surface/30 border border-border/50 rounded-xl flex items-center justify-between font-mono">
                <span className="text-[9px] font-bold text-dim uppercase tracking-wider">Cache Hit Ratio</span>
                <span className="text-xs font-black text-green">{cacheMetrics.hit_ratio_pct}%</span>
              </div>

              {lastProbeTs && (
                <div className="text-[9.5px] font-mono text-dim/70 text-right">
                  Last Probe: {new Date(lastProbeTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                <span className="text-[10px] font-black text-dim uppercase tracking-widest">Pipeline Health</span>
                <LoopVisualizer pipeline={app.loop_pipeline} />
              </div>

              {breakdown && Object.keys(breakdown).length > 0 && (
                <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                  <span className="text-[10px] font-black text-dim uppercase tracking-widest">REST Endpoint Call Distribution</span>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                    {Object.entries(breakdown).map(([label, count]) => (
                      <span key={label} className="px-2 py-1 rounded-lg bg-surface border border-border/60 text-text flex items-center gap-1.5">
                        <span className="text-accent font-bold">{count}</span>
                        <span className="truncate max-w-[120px]" title={label}>{label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    )}

  </div>
  );
};
