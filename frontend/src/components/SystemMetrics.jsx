import React from 'react';
import { Drawer } from 'vaul';
import { Activity, Zap, Leaf, ShieldAlert, Cpu, Rocket, Search, CheckCircle2, Copy, Check, Info, X, Filter, Database, Server } from 'lucide-react';
import { cn, PulseDot, Tooltip, Btn, VisuallyHidden } from './ui/primitives';

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
  const [isMobileDiagOpen, setIsMobileDiagOpen] = React.useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = React.useState('all');
  const [selectedStatus, setSelectedStatus] = React.useState('all');

  const app = monitoring?.application || {};
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
             <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
               <div className="flex items-center justify-between">
                 <span className="text-[8px] font-black text-dim uppercase tracking-widest flex items-center gap-1">
                   <Filter size={9} className="text-accent" /> REST Call Filter
                 </span>
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

               {/* Endpoint Filter Chips */}
               <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                 {endpointOptions.map(ep => (
                   <button
                     key={ep}
                     type="button"
                     onClick={() => setSelectedEndpoint(ep)}
                     className={cn(
                       "px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-tight shrink-0 transition-all cursor-pointer focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                       selectedEndpoint === ep
                         ? "bg-accent text-white shadow-sm"
                         : "bg-surface border border-border/60 text-dim hover:text-text"
                     )}
                   >
                     {ep === 'all' ? 'ALL CALLS' : ep}
                   </button>
                 ))}
               </div>

               {/* Filtered Endpoint Badges */}
               <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1 text-[9px] font-mono">
                 {Object.entries(breakdown)
                   .filter(([label]) => selectedEndpoint === 'all' || label === selectedEndpoint)
                   .map(([label, count]) => (
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
        <div className="flex items-center gap-3">
          <SystemMetric
            icon={Zap}
            label="REST"
            value={app.api_requests_total ?? '---'}
            colorClass="text-accent"
            compact={compact}
          />
          <div className="w-px h-3 bg-border/50" />
          <div className="flex items-center gap-2">
             <PulseDot color={app.exchange_uds_status === 'CONNECTED' ? "bg-green" : "bg-red"} />
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

            <div className="p-4 overflow-y-auto flex flex-col gap-4 text-xs">
              <div className="flex items-center justify-between p-3 bg-surface/50 border border-border/60 rounded-xl">
                <div className="flex items-center gap-2">
                  <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
                  <span className="font-bold uppercase tracking-wider text-[11px]">{wsStatus === 'live' ? 'WebSocket Live' : 'WebSocket Offline'}</span>
                </div>
                <Btn variant="ghost" onClick={handleCopyDiagnostics} className="px-2 py-1 text-[10px] font-bold border border-accent/30 bg-accent/10 text-accent flex items-center gap-1.5">
                  {copiedDiag ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                  {copiedDiag ? "Copied Snippet" : "Copy Diag Snippet"}
                </Btn>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono">
                <div className="p-3 bg-surface/30 border border-border/50 rounded-xl flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-dim uppercase tracking-wider">API Weight 1M</span>
                  <span className="text-sm font-black text-text">{rateLimit?.used_weight_1m ?? 0} / {rateLimit?.limit ?? 2400}</span>
                </div>
                <div className="p-3 bg-surface/30 border border-border/50 rounded-xl flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-dim uppercase tracking-wider">Cache Hit Ratio</span>
                  <span className="text-sm font-black text-green">{cacheMetrics.hit_ratio_pct}%</span>
                </div>
              </div>

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
