import React, { useState } from 'react'
import { useTradingStore } from '../store/trading'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { TradeDetailModal } from '../components/TradeDetailModal'
import { SectionLabel, StatCard, cn } from '../components/ui/primitives'
import { fmtUSD, safeNum } from '../lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Briefcase, Zap } from 'lucide-react'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { Sidebar, BottomNav } from '../components/Navigation'

const Breadcrumbs = () => (
  <nav className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dim mb-6">
    <button onClick={() => window.location.hash = '#/'} className="hover:text-text transition-colors">Cockpit</button>
    <span>/</span>
    <span className="text-text">All Active Trades</span>
  </nav>
)

const TradesView = () => {
  const { activeTrades, totalPnl, totalRiskPct, totalSlUsed, config, sidebarCollapsed, healthEnabled } = useTradingStore()
  const [selectedTrade, setSelectedTrade] = useState(null)

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
        <Breadcrumbs />
      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent shadow-sm border border-accent/20">
          <Briefcase size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Active Positions</h1>
          <p className="text-dim text-xs font-bold uppercase tracking-widest mt-1">Live monitoring across all strategies</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 lg:mb-12">
        <StatCard
          label="Active P&L"
          value={fmtUSD(activeTrades.reduce((acc, t) => acc + safeNum(t.pnl), 0))}
          color={activeTrades.reduce((acc, t) => acc + safeNum(t.pnl), 0) >= 0 ? "text-green" : "text-red"}
          subValue={`Total Session: ${fmtUSD(totalPnl)}`}
        />
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
                <ActiveTradeCard trade={trade} config={config} onClick={() => setSelectedTrade(trade)} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {selectedTrade && (
        <TradeDetailModal
          isOpen={!!selectedTrade}
          onClose={() => setSelectedTrade(null)}
          trade={selectedTrade}
          onTradeClose={handleCloseTrade}
        />
      )}
      </div>
      <BottomNav />
    </div>
  )
}

export default TradesView
