import React, { useEffect, useState, useCallback } from 'react';
import { useTradingStore } from '../store/trading';
import { healthAPI, sessionAPI } from '../api/client';
import { cn, PulseDot, Btn, Tooltip } from './ui/primitives';
import { 
  Activity, Zap, ShieldAlert, AlertTriangle, ShieldCheck, RefreshCw, Clock, Globe, Cpu, Radio, ShieldX, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

  // Second-by-second timer for live ban cooldown countdown (active only when ban/cooldown exists)
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

  // Fetch fresh Binance API health probes from backend
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

  // Resource Optimization: Poll health probes less frequently when collapsed (60s) or expanded (20s)
  useEffect(() => {
    fetchHealth(false);
    const pollMs = expanded ? 20000 : 60000;
    const interval = setInterval(() => fetchHealth(false), pollMs);
    return () => clearInterval(interval);
  }, [fetchHealth, expanded]);

  const msRemaining = banUntilMs ? Math.max(0, banUntilMs - now) : 0;

  // Format exact days, hours, mins, secs remaining
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

  // Weight Calculation & Warning Thresholds
  const usedWeight = rateLimit?.used_weight_1m || healthData?.rate_limit?.used_1m || 0;
  const weightLimit = rateLimit?.limit || healthData?.rate_limit?.weight_limit || 6000;
  const usagePct = Math.min(100, Math.round((usedWeight / weightLimit) * 100));

  // Determine overall status color & label
  let statusColor = "bg-green/10 border-green/30 text-green";
  let statusLabel = "OPERATIONAL";
  let StatusIcon = ShieldCheck;

  if (isBanned || isGeoBlocked) {
    statusColor = "bg-red/15 border-red/40 text-red";
    statusLabel = isGeoBlocked ? "GEO-BLOCKED (451)" : "IP BANNED (418)";
    StatusIcon = ShieldX;
  } else if (isRateLimited || usagePct >= 75) {
    statusColor = "bg-amber/15 border-amber/40 text-amber";
    statusLabel = usagePct >= 90 ? "CRITICAL SPIKE (>90%)" : "THROTTLED (>75%)";
    StatusIcon = AlertTriangle;
  } else if (wsStatus !== 'live' || healthData?.status === 'degraded') {
    statusColor = "bg-amber/10 border-amber/30 text-amber";
    statusLabel = "DEGRADED";
    StatusIcon = Activity;
  }

  const liveLatency = healthData?.live?.latency_ms ?? null;
  const testnetLatency = healthData?.testnet?.latency_ms ?? null;
  const udsStatus = healthData?.uds_status || (wsStatus === 'live' ? 'CONNECTED' : 'DISCONNECTED');

  return (
    <div className={cn(
      "bg-surface border border-border rounded-2xl p-3.5 sm:p-4 shadow-md shadow-black/10 flex flex-col gap-3 overflow-hidden w-full relative transition-all",
      isBanned && "border-red/40 bg-red/5",
      usagePct >= 80 && !isBanned && "border-amber/40 bg-amber/5",
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
        className="flex items-center justify-between gap-3 cursor-pointer select-none group min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition-all",
            statusColor
          )}>
            <StatusIcon size={14} />
          </div>
          <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-tight text-text truncate group-hover:text-accent transition-colors">
              Binance API & Latency Health
            </h3>

            {/* Quick Metrics when collapsed */}
            <div className="flex items-center gap-2 font-mono text-[9px] text-dim shrink-0">
              <span>Ping: <strong className="text-text">{liveLatency !== null ? `${liveLatency}ms` : '---'}</strong></span>
              <span>•</span>
              <span>Weight: <strong className={cn(usagePct >= 75 ? "text-amber font-bold" : "text-text")}>{usedWeight}/{weightLimit} ({usagePct}%)</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Status Badge */}
          <div className={cn(
            "px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border flex items-center gap-1.5 shrink-0",
            statusColor
          )}>
            <PulseDot color={isBanned ? "bg-red" : usagePct >= 75 ? "bg-amber" : "bg-green"} />
            {statusLabel}
          </div>

          {/* Expand Chevron Icon */}
          <div className={cn(
            "p-1 rounded-lg border border-border/60 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
            expanded && "text-accent border-accent/40 bg-accent/5 rotate-180"
          )}>
            <ChevronDown size={14} />
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
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden flex flex-col gap-4 pt-2 border-t border-border/20"
          >
            {/* BAN / COOLDOWN TIMER COUNTDOWN BANNER (if active or recently banned) */}
            {(isBanned || banUntilMs) && (
              <div className={cn(
                "p-3 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs shadow-inner",
                !timeObj.expired 
                  ? "bg-red/15 border-red/30 text-red shadow-red/5" 
                  : "bg-green/10 border-green/30 text-green"
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <Clock size={15} className={cn("shrink-0", !timeObj.expired ? "animate-pulse text-red" : "text-green")} />
                  <div className="flex flex-col min-w-0">
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

                {/* Time Remaining Component */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 font-bold tabular-nums text-xs">
                    {!timeObj.expired ? (
                      <>
                        <span className="text-red font-black tracking-widest">{timeObj.text}</span>
                        <span className="text-[8.5px] text-dim/80 font-sans uppercase">Remaining</span>
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
              {/* 1. API Weight Meter */}
              <div className="p-3 rounded-xl bg-surface-elevated/40 border border-border/40 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between text-dim text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Zap size={12} className={usagePct >= 75 ? "text-amber" : "text-accent"} /> API Weight (1M)
                  </span>
                  <span className="font-mono text-text">{usagePct}%</span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="text-sm sm:text-base font-black font-mono tabular-nums text-text">
                    {usedWeight} <span className="text-[10px] text-dim font-normal">/ {weightLimit}</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-border/40 overflow-hidden">
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
              <div className="p-3 rounded-xl bg-surface-elevated/40 border border-border/40 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between text-dim text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Globe size={12} className="text-accent" /> Live REST Ping
                  </span>
                  <span className={cn("font-mono text-[9px]", liveLatency !== null && liveLatency < 100 ? "text-green" : "text-amber")}>
                    {liveLatency !== null ? (liveLatency < 100 ? 'Optimal' : 'High') : 'Unknown'}
                  </span>
                </div>

                <div className="text-sm sm:text-base font-black font-mono tabular-nums text-text">
                  {liveLatency !== null ? `${liveLatency} ms` : '---'}
                </div>
              </div>

              {/* 3. Testnet Futures Latency */}
              <div className="p-3 rounded-xl bg-surface-elevated/40 border border-border/40 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between text-dim text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Cpu size={12} className="text-accent" /> Testnet Ping
                  </span>
                  <span className="font-mono text-[9px] text-dim">
                    {testnetLatency !== null ? 'Accessible' : 'Off'}
                  </span>
                </div>

                <div className="text-sm sm:text-base font-black font-mono tabular-nums text-text">
                  {testnetLatency !== null ? `${testnetLatency} ms` : '---'}
                </div>
              </div>

              {/* 4. User Data Stream (UDS) Status */}
              <div className="p-3 rounded-xl bg-surface-elevated/40 border border-border/40 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between text-dim text-[9.5px] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Radio size={12} className="text-accent" /> Account Stream
                  </span>
                  <span className={cn("font-mono text-[9px]", udsStatus === 'CONNECTED' ? "text-green" : "text-red")}>
                    {udsStatus}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-text">
                  <PulseDot color={udsStatus === 'CONNECTED' ? "bg-green" : "bg-red"} />
                  <span className="uppercase text-xs">{udsStatus === 'CONNECTED' ? 'Zero-Weight UDS Active' : 'Offline / Interrupted'}</span>
                </div>
              </div>
            </div>

            {/* Diagnostic Guidance & Refresh Action Bar */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/30 text-[9.5px] font-mono text-dim flex-wrap">
              <span className="flex items-center gap-1">
                <ShieldAlert size={11} className="text-accent" />
                Proactive Rate Limit Protection: Centralized Request Queue enforces 100ms inter-request pacing.
              </span>

              <div className="flex items-center gap-2">
                {lastProbeTs && (
                  <span className="text-dim/60">
                    Last Probe: {new Date(lastProbeTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}

                <Tooltip content="Trigger fresh latency probe to Binance endpoints">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fetchHealth(true); }}
                    disabled={loading}
                    className="px-2 py-1 rounded bg-surface border border-border/60 hover:border-accent/40 text-text hover:text-accent transition-all cursor-pointer flex items-center gap-1"
                    aria-label="Probe Fresh"
                  >
                    <RefreshCw size={11} className={cn(loading && "animate-spin text-accent")} />
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
