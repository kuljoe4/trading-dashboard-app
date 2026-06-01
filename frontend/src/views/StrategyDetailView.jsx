import React from 'react'
import { pnlColor, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { ActiveTradeBar } from '../components/ActiveTradeBar'
import { DecisionLog } from '../components/DecisionLog'
import { 
  StatCard, SectionLabel, StatusBadge, PaperBadge, DemoBadge, LiveBadge,
  ConditionWidget, PnLBars, CopyButton, cn
} from '../components/ui/primitives'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, BarChart3, TrendingUp, Zap
} from 'lucide-react'
import { EquityCurve } from '../components/Analytics'
import { useResourceFocus } from '../hooks/useResourceFocus'

const Breadcrumbs = ({ strategyLabel }) => (
  <nav className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dim mb-6">
    <button onClick={() => window.location.hash = '#/'} className="hover:text-accent transition-colors">Cockpit</button>
    <span>/</span>
    <span className="text-text">{strategyLabel}</span>
  </nav>
)

const StrategyDetailView = ({ s, onBack }) => {
  const { config, scannerResults, analytics, wsStatus } = useTradingStore()

  // Lifecycle-scoped subscription contract
  useResourceFocus('strategy', s.strategy_label);

  const isSyncing = wsStatus !== 'live' || (s.activeTrades.length > 0 && !s.activeTrades.some(t => t.strategy_label === s.strategy_label && t._is_full));

  const bestOpp = scannerResults[0] || { symbol: '---', pct: 0, dir: '---' }
  const scanMet = Math.abs(bestOpp.pct) >= config.scan_pct_threshold

  // Real signal check from backend
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] }
  const entryMet = scanMet && signalResult.allFired

  const signalsCount = config.enabled_signals?.length || 0
  const firedCount = signalResult.firedSignals?.length || 0
  const signalLogic = config.signal_logic || 'all'

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Breadcrumbs strategyLabel={s.strategy_label} />

      {/* Header */}
      <div className="flex items-center gap-5 mb-10">
        <button
          onClick={onBack}
          aria-label="Go back to cockpit"
          className="p-2.5 hover:bg-surface border border-border rounded-xl transition-all active:scale-90 group"
        >
          <ChevronLeft size={20} className="text-dim group-hover:text-text" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">Strategy Console</span>
            <StatusBadge status={s.sessionActive} />
            {config.trading_mode === 'paper' && <PaperBadge />}
            {config.trading_mode === 'testnet' && <DemoBadge />}
            {config.trading_mode === 'live' && <LiveBadge />}
          </div>
          <div className="text-[11px] text-dim mt-1.5 font-bold uppercase tracking-widest flex items-center gap-2">
            <Activity size={12} /> Loop Monitoring · {s.strategyId?.substring(0, 8)}
            <CopyButton value={s.strategyId} className="p-1" />
          </div>
        </div>
      </div>

      {/* Summary Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="Total P&L"
          value={fmtUSD(s.totalPnl)}
          color={s.totalPnl >= 0 ? "text-green" : "text-red"}
          subValue={isSyncing ? "Synchronizing..." : undefined}
          syncing={isSyncing}
        />
        <StatCard label="Hit Count" value={(s.entryCount ?? 0).toString()} color="text-accent" />
        <StatCard label="SL Budget" value={`$${Number(s.totalSlUsed || 0).toFixed(0)} / $${config.total_sl_guard_usdt}`} color={s.totalSlUsed > config.total_sl_guard_usdt * 0.7 ? "text-amber" : "text-text"} />
        <StatCard label="Active Risk" value={`${Number(s.totalRiskPct || 0).toFixed(1)}%`} color={s.totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
      </div>

      {/* Condition Widgets */}
      <div className="mb-10">
        <SectionLabel>Automation Gating</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <ConditionWidget
            label={`Scanner: % Move (${config.scan_interval})`}
            value={bestOpp.pct}
            threshold={config.scan_pct_threshold}
            satisfied={scanMet}
            sublabel={`Top Opp: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`}
          />
          <ConditionWidget
            label="Signal Authorization"
            value={firedCount}
            threshold={signalLogic === 'all' ? signalsCount : 1}
            unit={`/${signalsCount} signals`}
            satisfied={entryMet}
            sublabel={signalResult.reason || "Waiting for structural signal"}
          />
        </div>
      </div>

      {/* Active Positions */}
      <div className="mb-10">
        <SectionLabel>Tactical Overview</SectionLabel>
        <div className="space-y-5">
      {s.activeTrades.filter(t => t.strategy_label === s.strategy_label).length === 0 ? (
            <div className="bg-surface/20 border border-border border-dashed rounded-2xl p-16 text-center">
              <div className="text-sm font-bold text-dim uppercase tracking-widest flex flex-col items-center gap-4">
                <Zap size={32} className="opacity-20" />
                Waiting for strategy triggers...
              </div>
            </div>
          ) : (
        <AnimatePresence mode="popLayout">
          {s.activeTrades
            .filter(t => t.strategy_label === s.strategy_label)
            .map((trade, idx) => (
                <motion.div
                  key={trade.id || trade.symbol}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <ActiveTradeBar trade={trade} initialExpanded={idx === 0} />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col h-[450px] shadow-sm">
          <SectionLabel className="mb-4">
            <Activity size={14} className="text-accent" /> Intelligence Log
          </SectionLabel>
          <div className="flex-1 overflow-hidden">
            <DecisionLog />
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col h-[450px] shadow-sm">
          <SectionLabel className="mb-4">
            <TrendingUp size={14} className="text-accent" /> Equity Curve
          </SectionLabel>
          <div className="flex-1 flex flex-col justify-center">
             <EquityCurve
               data={analytics?.cumulativePnL || []}
               height={280}
             />
          </div>
          <div className="mt-6 pt-6 border-t border-border/40">
            <SectionLabel className="mb-2 text-[10px]">Recent Trade Distribution</SectionLabel>
            <PnLBars trades={s.activeTrades} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default StrategyDetailView;
