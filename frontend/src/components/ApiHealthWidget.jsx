import React, { useEffect, useState, useCallback, memo } from 'react';
import { useTradingStore } from '../store/trading';
import { healthAPI, sessionAPI } from '../api/client';
import { cn, PulseDot, Btn, Tooltip } from './ui/primitives';
import { 
  Activity, Zap, ShieldAlert, AlertTriangle, ShieldCheck, RefreshCw, Clock, Globe, Cpu, Radio, ShieldX, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Compact Signal Strength Bars for Latency
const SignalBars = memo(({ latency }) => {
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

export const ApiHealthWidget = ({ className, compact = false, defaultExpanded = false }) => {
  const { rateLimit, apiStatus, wsStatus } = useTradingStore(state => ({
    rateLimit: state.rateLimit,
    apiStatus: state.apiStatus,
    wsStatus: state.wsStatus,
  }));

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastProbeTs, setLastProbeTs] = useState(null);
  const [now, setNow] = useState(Date.now());

  const banUntilMs = apiStatus?.banUntil 
    ? new Date(apiStatus.banUntil).getTime() 
    : (healthData?.ip_status?.ban_until ? Number(healthData.ip_status.ban_until) : null);

  const isBanned = apiStatus?.isBanned || healthData?.ip_status?.is_banned || false;
  const isRateLimited = apiStatus?.isRateLimited || healthData?.ip_status?.is_rate_limited || false;
  const isGeoBlocked = apiStatus?.isGeoBlocked || healthData?.geo_restricted || false;

  useEffect(() => {
    if (!banUntilMs && !isBanned) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [banUntilMs, isBanned]);

  const fetchHealth = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const res = await healthAPI.getBinanceHealth(fresh);
      if (res && res.data) {
        setHealthData(res.data);
        setLastProbeTs(Date.now());
      }
    } catch (err) {
      console.warn('Failed to fetch Binance health probe:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth(false);
    const pollMs = expanded ? 20000 : 60000;
    const interval = setInterval(() => fetchHealth(false), pollMs);
    return () => clearInterval(interval);
  }, [fetchHealth, expanded]);

  const msRemaining = banUntilMs ? Math.max(0, banUntilMs - now) : 0;

  const formatTimeLeft = (ms) => {
    if (ms <= 0) return { text: 'None (Lifted)', days: 0, hours: 0, mins: 0, secs: 0, expired: true };
    const totalSecs = Math.floor(ms / 1000);
    const days = Math.floor(totalSecs / (24 * 3600));
    const hours = Math.floor((totalSecs % (24 * 3600)) / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return {
      text: parts.join(' '),
      days,
      hours,
      mins,
      secs,
      expired: false
    };
  };

  const timeObj = formatTimeLeft(msRemaining);

  const usedWeight = rateLimit?.used_weight_1m || healthData?.rate_limit?.used_1m || 0;
  const weightLimit = rateLimit?.limit || healthData?.rate_limit?.weight_limit || 6000;
  const usagePct = Math.min(100, Math.round((usedWeight / weightLimit) * 100));

  let statusColor = "bg-green/10 border-green/30 text-green";
  let statusBadgeBg = "bg-green/15 border-green/40 text-green";
  let statusLabel = "OPERATIONAL";
  let StatusIcon = ShieldCheck;

  if (isBanned || isGeoBlocked) {
    statusColor = "bg-red/15 border-red/40 text-red";
    statusBadgeBg = "bg-red/20 border-red/50 text-red";
    statusLabel = isGeoBlocked ? "GEO-BLOCKED (451)" : "IP BANNED (418)";
    StatusIcon = ShieldX;
  } else if (isRateLimited || usagePct >= 75) {
    statusColor = "bg-amber/15 border-amber/40 text-amber";
    statusBadgeBg = "bg-amber/20 border-amber/50 text-amber";
    statusLabel = usagePct >= 90 ? "CRITICAL (>90%)" : "THROTTLED (>75%)";
    StatusIcon = AlertTriangle;
  } else if (wsStatus !== 'live' || healthData?.status === 'degraded') {
    statusColor = "bg-amber/10 border-amber/30 text-amber";
    statusBadgeBg = "bg-amber/15 border-amber/40 text-amber";
    statusLabel = "DEGRADED";
    StatusIcon = Activity;
  }

  const liveLatency = healthData?.live?.latency_ms ?? null;
  const testnetLatency = healthData?.testnet?.latency_ms ?? null;
  const udsStatus = healthData?.uds_status || (wsStatus === 'live' ? 'CONNECTED' : 'DISCONNECTED');

  const pingColor = liveLatency === null ? "text-dim" : liveLatency < 80 ? "text-green" : liveLatency < 180 ? "text-amber" : "text-red";

  return (
    <div className={cn(
      "bg-surface border border-border/80 rounded-2xl p-2.5 sm:p-3.5 shadow-lg shadow-black/20 flex flex-col gap-2.5 overflow-hidden w-full relative transition-all backdrop-blur-md",
      isBanned && "border-red/50 bg-red/5 shadow-[0_0_20px_rgba(239,68,68,0.1)]",
      usagePct >= 80 && !isBanned && "border-amber/50 bg-amber/5 shadow-[0_0_20px_rgba(245,158,11,0.1)]",
      className
    )}>
      {/* Clickable Header Bar (Collapsible Toggle) */}
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setExpanded(!expanded))}
        aria-expanded={expanded}
        aria-controls="api-health-widget-content"
        className="flex items-center justify-between gap-2 cursor-pointer select-none group min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      >
        {/* Left Side: Icon & Title */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <div className={cn(
            "w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 border transition-all",
            statusColor
          )}>
            <StatusIcon size={13} className="sm:text-[14px]" />
          </div>
          <h3 className="text-xs sm:text-sm font-black uppercase tracking-tight text-text truncate group-hover:text-accent transition-colors">
            Binance API & Latency
          </h3>
        </div>

        {/* Center: High Density Live Telemetry Chips (Mobile & Desktop) */}
        <div className="flex items-center gap-1.5 sm:gap-2 font-mono text-[9px] sm:text-[10px] min-w-0 overflow-x-auto no-scrollbar">
          {/* Latency Chip */}
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-elevated/80 border border-border/50 shrink-0">
            <SignalBars latency={liveLatency} />
            <span className="text-dim/80 hidden xs:inline">Ping:</span>
            <span className={cn("font-bold font-mono tabular-nums", pingColor)}>
              {liveLatency !== null ? `${liveLatency}ms` : '---'}
            </span>
          </div>

          {/* Weight Utilization Chip */}
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-elevated/80 border border-border/50 shrink-0">
            <Zap size={10} className={usagePct >= 75 ? "text-amber" : "text-accent"} />
            <span className="text-dim/80 hidden xs:inline">Weight:</span>
            <span className={cn("font-bold font-mono tabular-nums", usagePct >= 75 ? "text-amber" : "text-text")}>
              {usedWeight}/{weightLimit} ({usagePct}%)
            </span>
          </div>

          {/* UDS Stream Chip (hidden on tiny screens, visible sm+) */}
          <div className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-elevated/80 border border-border/50 shrink-0">
            <Radio size={10} className={udsStatus === 'CONNECTED' ? "text-green" : "text-red"} />
            <span className="text-dim/80">UDS:</span>
            <span className={cn("font-bold font-mono text-[9px]", udsStatus === 'CONNECTED' ? "text-green" : "text-red")}>
              {udsStatus === 'CONNECTED' ? 'LIVE' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Right Side: Status Badge & Chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={cn(
            "px-1.5 sm:px-2 py-0.5 rounded-lg text-[8px] sm:text-[9px] font-black uppercase tracking-wider border flex items-center gap-1 shrink-0",
            statusBadgeBg
          )}>
            <PulseDot color={isBanned ? "bg-red" : usagePct >= 75 ? "bg-amber" : "bg-green"} />
            <span className="hidden xs:inline">{statusLabel}</span>
          </div>

          <div className={cn(
            "p-1 rounded-lg border border-border/60 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
            expanded && "text-accent border-accent/40 bg-accent/5 rotate-180"
          )}>
            <ChevronDown size={13} />
          </div>
        </div>
      </div>

      {/* Expanded Content View (Collapsible) */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            id="api-health-widget-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden flex flex-col gap-3 pt-2 border-t border-border/30"
          >
            {/* BAN / COOLDOWN TIMER COUNTDOWN BANNER (if active or recently banned) */}
            {(isBanned || banUntilMs) && (
              <div className={cn(
                "p-2.5 sm:p-3 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-2.5 font-mono text-xs shadow-inner",
                !timeObj.expired 
                  ? "bg-red/15 border-red/40 text-red shadow-red/5" 
                  : "bg-green/10 border-green/30 text-green"
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={14} className={cn("shrink-0", !timeObj.expired ? "animate-pulse text-red" : "text-green")} />
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="font-black text-[10px] uppercase tracking-wider">
                      {!timeObj.expired ? 'Active IP Ban / Cooldown In Effect' : 'IP Cooldown Completed'}
                    </span>
                    <span className="text-[9px] text-dim truncate">
                      {!timeObj.expired 
                        ? `REST requests throttled to protect exchange IP standing.` 
                        : `Normal REST API requests unblocked.`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/40 border border-white/10 font-bold tabular-nums text-xs">
                    {!timeObj.expired ? (
                      <>
                        <span className="text-red font-black tracking-widest">{timeObj.text}</span>
                        <span className="text-[8px] text-dim/80 font-sans uppercase">Left</span>
                      </>
                    ) : (
                      <span className="text-green font-bold text-xs uppercase">0d 0h 0m 0s (Lifted)</span>
                    )}
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
                      className="text-[9px] py-0.5 px-2 border-red/30 hover:bg-red/20 text-red"
                    >
                      Clear Lock
                    </Btn>
                  )}
                </div>
              </div>
            )}

            {/* Metric Cards Grid: Weight Usage, Live Latency, Testnet Latency, UDS Connection */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              {/* 1. API Weight Meter */}
              <div className="p-2.5 sm:p-3 rounded-xl bg-surface-elevated/40 border border-border/50 flex flex-col justify-between gap-1.5">
                <div className="flex items-center justify-between text-dim text-[9px] sm:text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Zap size={11} className={usagePct >= 75 ? "text-amber" : "text-accent"} /> Weight (1M)
                  </span>
                  <span className={cn("font-mono font-bold text-[9px]", usagePct >= 75 ? "text-amber" : "text-green")}>{usagePct}%</span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="text-xs sm:text-sm font-black font-mono tabular-nums text-text">
                    {usedWeight} <span className="text-[9px] text-dim font-normal">/ {weightLimit}</span>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden relative">
                    <div 
                      className={cn(
                        "h-full transition-all duration-500 rounded-full",
                        usagePct >= 90 ? "bg-red" : usagePct >= 75 ? "bg-amber" : "bg-accent"
                      )}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* 2. Live Futures Latency */}
              <div className="p-2.5 sm:p-3 rounded-xl bg-surface-elevated/40 border border-border/50 flex flex-col justify-between gap-1.5">
                <div className="flex items-center justify-between text-dim text-[9px] sm:text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Globe size={11} className="text-accent" /> Live REST Ping
                  </span>
                  <span className={cn("font-mono text-[9px] font-bold", liveLatency !== null && liveLatency < 100 ? "text-green" : "text-amber")}>
                    {liveLatency !== null ? (liveLatency < 80 ? 'Optimal' : liveLatency < 180 ? 'Normal' : 'High') : 'Unknown'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-black font-mono tabular-nums text-text">
                    {liveLatency !== null ? `${liveLatency} ms` : '---'}
                  </span>
                  <SignalBars latency={liveLatency} />
                </div>
              </div>

              {/* 3. Testnet Futures Latency */}
              <div className="p-2.5 sm:p-3 rounded-xl bg-surface-elevated/40 border border-border/50 flex flex-col justify-between gap-1.5">
                <div className="flex items-center justify-between text-dim text-[9px] sm:text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Cpu size={11} className="text-accent" /> Testnet Ping
                  </span>
                  <span className="font-mono text-[9px] text-dim font-semibold">
                    {testnetLatency !== null ? 'Accessible' : 'Off'}
                  </span>
                </div>

                <div className="text-xs sm:text-sm font-black font-mono tabular-nums text-text">
                  {testnetLatency !== null ? `${testnetLatency} ms` : '---'}
                </div>
              </div>

              {/* 4. User Data Stream (UDS) Status */}
              <div className="p-2.5 sm:p-3 rounded-xl bg-surface-elevated/40 border border-border/50 flex flex-col justify-between gap-1.5">
                <div className="flex items-center justify-between text-dim text-[9px] sm:text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Radio size={11} className="text-accent" /> Account Stream
                  </span>
                  <span className={cn("font-mono text-[9px] font-bold", udsStatus === 'CONNECTED' ? "text-green" : "text-red")}>
                    {udsStatus}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-text">
                  <PulseDot color={udsStatus === 'CONNECTED' ? "bg-green" : "bg-red"} />
                  <span className="uppercase text-[10px] sm:text-xs truncate">{udsStatus === 'CONNECTED' ? 'Zero-Weight UDS' : 'Offline / Paused'}</span>
                </div>
              </div>
            </div>

            {/* Diagnostic Guidance & Refresh Action Bar */}
            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/30 text-[9px] sm:text-[9.5px] font-mono text-dim flex-wrap">
              <span className="flex items-center gap-1">
                <ShieldAlert size={10} className="text-accent shrink-0" />
                <span>Centralized Proxy Queue: 100ms inter-request pacing active.</span>
              </span>

              <div className="flex items-center gap-2 shrink-0">
                {lastProbeTs && (
                  <span className="text-dim/60 hidden sm:inline">
                    Last Probe: {new Date(lastProbeTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}

                <Tooltip content="Trigger fresh latency probe to Binance endpoints">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fetchHealth(true); }}
                    disabled={loading}
                    className="px-2 py-0.5 rounded-lg bg-surface border border-border/60 hover:border-accent/40 text-text hover:text-accent transition-all cursor-pointer flex items-center gap-1 text-[9px] font-mono font-bold"
                    aria-label="Probe Fresh"
                  >
                    <RefreshCw size={10} className={cn(loading && "animate-spin text-accent")} />
                    <span>Probe Fresh</span>
                  </button>
                </Tooltip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ApiHealthWidget;
