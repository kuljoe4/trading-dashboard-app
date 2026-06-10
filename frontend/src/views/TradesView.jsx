import React, { useState, lazy, Suspense } from 'react'
import { useTradingStore } from '../store/trading'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { SectionLabel, StatCard, cn, ViewHeader } from '../components/ui/primitives'
import { fmtUSD, pnlClass, safeNum } from '../lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Briefcase, Zap } from 'lucide-react'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { Sidebar, BottomNav } from '../components/Navigation'

const TradeDetailModal = lazy(() => import('../components/TradeDetailModal').then(m => ({ default: m.TradeDetailModal })))

const TradesView = () => {
  const { activeTrades, totalPnl, totalRiskPct, totalSlUsed, config, sidebarCollapsed, healthEnabled } = useTradingStore()
  const [selectedTradeId, setSelectedTradeId] = useState(null)

  const selectedTrade = activeTrades.find(t => t.id === selectedTradeId || t.symbol === selectedTradeId)

  // Lifecycle-scoped subscription contract
  useResourceFocus('global_trades');

  const handleCloseTrade = async (symbol) => {
    try {
      await sessionAPI.closeTrade(symbol)
      setSelectedTrade(null)
    } catch (e) {
      alert('Failed to close trade: ' + (e?.response?.data?.message || e.message))
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8 lg:mb-12">
        {(() => {
          const activePnl = activeTrades.reduce((acc, t) => acc + safeNum(t.pnl), 0);
          return (
            <StatCard
              label="Active P&L"
              value={fmtUSD(activePnl)}
              color={pnlClass(activePnl)}
              subValue={`Total: ${fmtUSD(totalPnl)}`}
            />
          );
        })()}
        <StatCard label="Active Risk" value={`${totalRiskPct.toFixed(2)}%`} color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
        <StatCard label="Positions" value={activeTrades.length.toString()} color="text-accent" />
      </div>

      <div className="space-y-6">
        <SectionLabel>Live Tactical Map</SectionLabel>

        {activeTrades.length === 0 ? (
          <div className="bg-surface/20 border border-border border-dashed rounded-3xl p-20 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center mb-6 text-dim/20">
              <Zap size={32} />
            </div>
            <h3 className="text-lg font-bold mb-2">No Active Trades</h3>
            <p className="text-dim text-sm max-w-xs mx-auto">
              The engine is currently scanning for opportunities. New positions will appear here in real-time.
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {activeTrades.map((trade, idx) => (
              <motion.div
                key={trade.id || trade.symbol}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <ActiveTradeCard trade={trade} config={config} onClick={() => setSelectedTradeId(trade.id || trade.symbol)} />
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
