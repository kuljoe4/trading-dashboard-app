import React, { useMemo } from 'react'
import { pnlColor, pnlClass, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { DecisionLog } from '../components/DecisionLog'
import { 
  StatCard, SectionLabel, StatusBadge, PaperBadge, DemoBadge, LiveBadge,
  ConditionWidget, PnLBars, CopyButton, cn, ViewHeader
} from '../components/ui/primitives'
import { ScannerPreview } from './DashboardView'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, BarChart3, TrendingUp, Zap
} from 'lucide-react'
import { EquityCurve } from '../components/Analytics'
import { useResourceFocus } from '../hooks/useResourceFocus'

const StrategyDetailView = ({ s, onBack }) => {
  const { config, scannerResults, analytics, wsStatus, isSyncing, isThrottled, isSyncingOnResume, sessionActive } = useTradingStore()

  // BOLT OPTIMIZATION: Resolve variant-specific configuration if viewing a strategy variant
  const strategyConfig = useMemo(() => {
    if (!config) return {};
    const idx = config.strategy_variants?.findIndex(v => v.strategy_label === s.strategy_label);
    return (idx !== -1 && idx !== undefined)
      ? { ...config, ...config.strategy_variants[idx] }
      : config;
  }, [config, s.strategy_label]);

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming

  // Lifecycle-scoped subscription contract
  useResourceFocus('strategy', s.strategy_label);

  const bestOpp = useMemo(() => scannerResults[0] || { symbol: '---', pct: 0, dir: '---' }, [scannerResults])
  const scanMet = Math.abs(bestOpp.pct) >= strategyConfig.scan_pct_threshold
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] }
  const entryMet = scanMet && signalResult.allFired
  const signalsCount = strategyConfig.enabled_signals?.length || 0
  const firedCount = signalResult.firedSignals?.length || 0
  const signalLogic = strategyConfig.signal_logic || 'all'

  return (
    <motion.div
      layout
      className="max-w-[1200px] mx-auto p-3 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 lg:pb-10"
    >
      <ViewHeader
        icon={Activity}
        title={s.strategy_label}
        subTitle={`Loop Monitoring · ${s.strategyId?.substring(0, 8)}`}
        backAction={onBack}
      >
         <div className="flex items-center gap-2">
           <CopyButton value={s.strategyId} className="p-1" />
           <StatusBadge status={s.sessionActive} />
         </div>
      </ViewHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-10">
        <StatCard
          label="Active P&L"
          value={fmtUSD(s.activePnl)}
          color={pnlClass(s.activePnl)}
          subValue={analytics === null ? "Syncing..." : `Total: ${fmtUSD(s.totalPnl)}`}
          syncing={showResumingFeedback || isSyncing || (analytics === null && s.activePnl === 0)}
        />
        <StatCard label="Hit Count" value={(s.entryCount ?? 0).toString()} color="text-accent" />
        <StatCard label="SL Budget" value={`$${Number(s.totalSlUsed || 0).toFixed(0)}`} subValue={`Limit $${strategyConfig.total_sl_guard_usdt}`} color={s.totalSlUsed > strategyConfig.total_sl_guard_usdt * 0.7 ? "text-amber" : "text-text"} />
        <StatCard label="Active Risk" value={`${Number(s.totalRiskPct || 0).toFixed(1)}%`} color={s.totalRiskPct > strategyConfig.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
      </div>

      <div className="mb-10">
        <SectionLabel>Automation Gating</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          <ConditionWidget label={`Scanner: % Move (${strategyConfig.scan_interval})`} value={bestOpp.pct} threshold={strategyConfig.scan_pct_threshold} satisfied={scanMet} sublabel={`Top Opp: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`} />
          <ConditionWidget label="Signal Authorization" value={firedCount} threshold={signalLogic === 'all' ? signalsCount : 1} unit={`/${signalsCount} signals`} satisfied={entryMet} sublabel={signalResult.reason || "Waiting for structural signal"} />
        </div>

        <ScannerPreview
          scannerResults={(scannerResults || []).filter(Boolean)}
          config={strategyConfig}
          onOpen={() => window.dispatchEvent(new CustomEvent('toggle-scanner'))}
        />
      </div>

    </motion.div>
  )
}
export default StrategyDetailView
