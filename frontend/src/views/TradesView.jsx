import React, { useState, lazy, Suspense, useMemo } from 'react'
import { useTradingStore } from '../store/trading'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { SectionLabel, StatCard, cn, ViewHeader, Btn } from '../components/ui/primitives'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Briefcase, Zap } from 'lucide-react'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { Sidebar, BottomNav } from '../components/Navigation'
import { lazyWithRetry } from '../lib/lazy'

const TradeDetailModal = lazyWithRetry(() => import('../components/TradeDetailModal').then(m => ({ default: m.TradeDetailModal })))
const preloadTradeDetailModal = () => {
  import('../components/TradeDetailModal');
};

const TradesView = () => {
  const { activeTrades, totalPnl, totalRiskPct, totalSlUsed, config, sidebarCollapsed, healthEnabled, isThrottled, wsStatus, isSyncingOnResume, sessionActive, totalEstPnlToRealize } = useTradingStore()
  const [selectedTradeId, setSelectedTradeId] = useState(null)

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming

  // BOLT OPTIMIZATION: Combine active trade calculations into a single-pass loop-fused useMemo
  const { activePnl, activeEstPnl, trueProjectedPnl, peakRr } = useMemo(() => {
    const trades = activeTrades || [];
    let pnl = 0;
    let estPnl = 0;
    let maxRr = 0;
    const len = trades.length;
    for (let i = 0; i < len; i++) {
      const t = trades[i];
      pnl += safeNum(t.pnl);
      estPnl += safeNum(t.est_pnl_to_realize);
      maxRr = Math.max(maxRr, Number(t.max_rr ?? t.max_rr_achieved ?? 0));
    }
    const projected = (totalPnl - pnl) + estPnl;
    return {
      activePnl: pnl,
      activeEstPnl: estPnl,
      trueProjectedPnl: projected,
      peakRr: maxRr
    };
  }, [activeTrades, totalPnl]);

  const selectedTrade = (activeTrades || []).find(t => t.id === selectedTradeId || t.symbol === selectedTradeId)

  // Lifecycle-scoped subscription contract
  useResourceFocus('global_trades');

  const addAlert = useTradingStore(state => state.addAlert);
  const handleCloseTrade = async (symbol) => {
    try {
      await sessionAPI.closeTrade(symbol)
      setSelectedTradeId(null)
      addAlert({ level: 'success', title: 'Liquidation Started', message: `Manual closure request for ${symbol} sent to exchange.` });
    } catch (e) {
      addAlert({ level: 'error', title: 'Closure Failed', message: e?.response?.data?.message || e.message || 'Could not close position.' });
    }
  }

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <Sidebar />
      <div className={cn(
        "max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:pb-8 transition-all",
        healthEnabled ? "pb-48" : "pb-32"
      )}>
        <ViewHeader
          icon={Briefcase}
          title="Active Positions"
          subTitle="Live monitoring across all strategies"
          backAction={() => window.location.hash = '#/'}
        />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8 lg:mb-12">
        <StatCard
          label="Active P&L"
          value={fmtUSD(activePnl)}
          color={pnlClass(activePnl)}
          subValue={
            <div className="flex flex-col gap-0.5 mt-1 min-w-[130px]">
              <div className="flex items-center justify-between text-[10px] text-dim/60">
                <span>Session Return:</span>
                <span className="font-bold font-mono" style={{ color: pnlColor(totalPnl) }}>{fmtUSD(totalPnl)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-dim/60">
                <span>Est. Target:</span>
                <span className="font-bold font-mono" style={{ color: pnlColor(activeEstPnl) }}>≈ {fmtUSD(activeEstPnl)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-dim/80 pt-0.5 border-t border-border/20">
                <span>Projected:</span>
                <span className="font-bold font-mono" style={{ color: pnlColor(trueProjectedPnl) }}>≈ {fmtUSD(trueProjectedPnl)}</span>
              </div>
            </div>
          }
        />
        <StatCard label="Active Risk" value={`${Number(totalRiskPct || 0).toFixed(2)}%`} color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
        <StatCard label="Peak RR" value={`+${Number(peakRr || 0).toFixed(2)}`} color="text-accent" />
        <StatCard label="Positions" value={activeTrades.length.toString()} color="text-accent" />
      </div>

      <div className="space-y-6">
        <SectionLabel>Live Tactical Map</SectionLabel>

        {(!activeTrades || activeTrades.length === 0) ? (
          <div className="bg-surface/20 border border-border border-dashed rounded-3xl p-20 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center mb-6 text-dim/20">
              <Zap size={32} />
            </div>
            <h3 className="text-lg font-bold mb-2">No Active Trades</h3>
            <p className="text-dim text-sm max-w-xs mx-auto mb-8">
              The engine is currently scanning for opportunities. New positions will appear here in real-time.
            </p>
            <Btn
              variant="primary"
              onClick={() => window.dispatchEvent(new Event('toggle-scanner'))}
              icon={Zap}
              className="px-8"
            >
              Open Live Scanner
            </Btn>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {(activeTrades || []).map((trade, idx) => (
              <motion.div
                key={trade.id || trade.symbol}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <ActiveTradeCard trade={trade} config={config} onClick={() => setSelectedTradeId(trade.id || trade.symbol)} onMouseEnter={preloadTradeDetailModal} isResuming={isResuming} showResumingFeedback={showResumingFeedback} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <Suspense fallback={null}>
        {selectedTrade && (
          <TradeDetailModal
            isOpen={!!selectedTrade}
            onClose={() => setSelectedTradeId(null)}
            trade={selectedTrade}
            onTradeClose={handleCloseTrade}
          />
        )}
      </Suspense>
      </div>
      <BottomNav />
    </div>
  )
}

export default TradesView
