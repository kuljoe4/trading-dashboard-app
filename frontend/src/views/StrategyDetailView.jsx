import React, { useMemo } from 'react'
import { pnlColor, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
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
  const { config, scannerResults, analytics, wsStatus, isSyncing } = useTradingStore()

  // Lifecycle-scoped subscription contract
  useResourceFocus('strategy', s.strategy_label);

  const bestOpp = useMemo(() => scannerResults[0] || { symbol: '---', pct: 0, dir: '---' }, [scannerResults])
  const scanMet = Math.abs(bestOpp.pct) >= config.scan_pct_threshold
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] }
  const entryMet = scanMet && signalResult.allFired
  const signalsCount = config.enabled_signals?.length || 0
  const firedCount = signalResult.firedSignals?.length || 0
  const signalLogic = config.signal_logic || 'all'

  return (
    <motion.div
      layout
      className="max-w-[1200px] mx-auto p-3 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 lg:pb-10"
    >
      <div className="flex items-center gap-4 mb-6 md:mb-10">
        <button onClick={onBack} aria-label="Go back" className="p-2.5 hover:bg-surface border border-border rounded-xl transition-all active:scale-90 group"><ChevronLeft size={20} className="text-dim group-hover:text-text" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-3"><span className="text-2xl font-bold">Strategy Console</span><StatusBadge status={s.sessionActive} />{config.trading_mode === 'paper' && <PaperBadge />}{config.trading_mode === 'testnet' && <DemoBadge />}{config.trading_mode === 'live' && <LiveBadge />}</div>
          <div className="text-[11px] text-dim mt-1.5 font-bold uppercase tracking-widest flex items-center gap-2"><Activity size={12} /> Loop Monitoring · {s.strategyId?.substring(0, 8)}<CopyButton value={s.strategyId} className="p-1" /></div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-10">
        <StatCard
          label="Active P&L"
          value={fmtUSD(s.activePnl)}
          color={s.activePnl >= 0 ? "text-green" : "text-red"}
          subValue={analytics === null ? "Synchronizing..." : `Total Session: ${fmtUSD(s.totalPnl)}`}
          syncing={isSyncing || (analytics === null && s.activePnl === 0)}
        />
        <StatCard label="Hit Count" value={(s.entryCount ?? 0).toString()} color="text-accent" />
        <StatCard label="SL Budget" value={`$${Number(s.totalSlUsed || 0).toFixed(0)} / $${config.total_sl_guard_usdt}`} color={s.totalSlUsed > config.total_sl_guard_usdt * 0.7 ? "text-amber" : "text-text"} />
        <StatCard label="Active Risk" value={`${Number(s.totalRiskPct || 0).toFixed(1)}%`} color={s.totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
      </div>

      <div className="mb-10">
        <SectionLabel>Automation Gating</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <ConditionWidget label={`Scanner: % Move (${config.scan_interval})`} value={bestOpp.pct} threshold={config.scan_pct_threshold} satisfied={scanMet} sublabel={`Top Opp: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`} />
          <ConditionWidget label="Signal Authorization" value={firedCount} threshold={signalLogic === 'all' ? signalsCount : 1} unit={`/${signalsCount} signals`} satisfied={entryMet} sublabel={signalResult.reason || "Waiting for structural signal"} />
        </div>
      </div>

    </motion.div>
  )
}
export default StrategyDetailView
