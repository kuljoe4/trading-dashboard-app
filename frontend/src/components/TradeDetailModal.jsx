import React, { useState, useEffect, memo } from 'react'
import { Drawer } from 'vaul'
import { X, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn, CopyButton, VisuallyHidden, Tooltip, ModalAlertTicker } from './ui/primitives'
import { formatDuration } from '../lib/formatters'
import { TradeDetailContent } from './trade/TradeDetailContent'
import { useTradingStore } from '../store/trading'
import { RefreshCw } from 'lucide-react'
import { useDelayedActive } from '../hooks/useDelayedActive'

export const TradeDetailModal = memo(({ trade, isOpen, onClose, onTradeClose }) => {
  const [isClosing, setIsClosing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const { addAlert, isThrottled, wsStatus, isSyncingOnResume, sessionActive, config } = useTradingStore(state => ({
    addAlert: state.addAlert,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume,
    sessionActive: state.sessionActive,
    config: state.config
  }));

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showDelayedResuming = useDelayedActive(sessionActive && isResuming, 1500);
  const showResumingFeedback = sessionActive && (wsStatus === 'error' || showDelayedResuming);

  useEffect(() => {
    if (!isOpen) return
    return () => {
      setConfirmClose(false) // Reset confirm state when modal closes
    }
  }, [isOpen])

  if (!trade) return null

  const isLong = trade.direction === 'LONG'

  const handleForceClose = async (symbol) => {
    setIsClosing(true)
    try {
      await onTradeClose(symbol)
      addAlert({ level: 'info', title: 'Close Initiated', message: `Sending market close order for ${symbol} to Binance.` });
      onClose()
    } catch (e) {
      console.error('Failed to force close trade from modal:', e)
      addAlert({ level: 'error', title: 'Close Failed', message: `Could not close ${symbol}. Check logs for exchange error.` });
    } finally {
      setIsClosing(false)
    }
  }

  return (
    <Drawer.Root open={isOpen} onOpenChange={onClose} repositionInputs={false} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
        <Drawer.Content
          className="bg-background border-t border-border flex flex-col rounded-t-[32px] fixed inset-x-0 bottom-0 top-[3dvh] w-full max-w-full z-[101] focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.6)] lg:max-w-[1140px] xl:max-w-[1260px] lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2 lg:top-[4dvh] lg:bottom-[4dvh] lg:rounded-3xl lg:border lg:border-border/70 lg:shadow-[0_25px_80px_rgba(0,0,0,0.85)] h-auto overflow-hidden">

          {/* Drawer Handle */}
          <div className="p-2 bg-background rounded-t-[32px] lg:rounded-t-3xl flex flex-col items-center shrink-0">
            <div className="w-12 h-1.5 bg-border rounded-full mb-2" />
            <VisuallyHidden>
              <Drawer.Title>Trade Details for {trade.symbol}</Drawer.Title>
              <Drawer.Description id="modal-description">
                Detailed view of the active trade for {trade.symbol}, including P&L and exit signals.
              </Drawer.Description>
            </VisuallyHidden>
          </div>

          {/* Drawer scrollable content */}
          <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden no-scrollbar px-3.5 sm:px-4 pt-4 lg:px-6 lg:pt-6 pb-20 lg:pb-12 overscroll-contain" data-vaul-no-drag>
            <div className="flex items-center justify-between gap-2 mb-3 sticky -top-5 bg-background/80 backdrop-blur-sm z-20 pb-2 pt-2 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-md transition-transform duration-500 hover:scale-105",
                  isLong ? "bg-green/10 text-green shadow-green/20" : "bg-red/10 text-red shadow-red/20"
                )}>
                  {isLong ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h2 id="modal-title" className="text-base font-black tracking-tighter truncate min-w-0">{trade.symbol}</h2>
                    <CopyButton value={trade.symbol} className="opacity-40 hover:opacity-100 shrink-0" />
                  </div>
                  <div className="flex items-center gap-1.5 text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] min-h-[14px] min-w-0 flex-wrap">
                    <span className={cn("font-bold font-mono tracking-wider shrink-0", isLong ? 'text-green' : 'text-red')}>
                      {trade.direction}
                    </span>
                    {trade.strategy_label && (
                      <>
                        <span className="text-dim/40 font-mono shrink-0">·</span>
                        <span className="text-dim/80 font-mono tracking-normal truncate max-w-[140px] sm:max-w-[260px]">
                          via {trade.strategy_label}
                        </span>
                      </>
                    )}
                    {trade.strategy_label && config && (
                      <>
                        <span className="text-dim/40 font-mono shrink-0">·</span>
                        <span className="text-dim/60 font-mono text-[8px] uppercase tracking-wider shrink-0">
                          {trade.strategy_label === (config.strategy_label || 'Momentum Strategy') ? 'Base' : 'Variant'}
                        </span>
                      </>
                    )}
                    <span
                      aria-hidden={!showResumingFeedback}
                      title="Syncing feed"
                      className={cn(
                        "inline-flex items-center gap-1 text-accent font-mono tracking-normal shrink-0 transition-opacity duration-200",
                        showResumingFeedback ? "opacity-100" : "opacity-0 pointer-events-none"
                      )}
                    >
                      <RefreshCw size={9} className={showResumingFeedback ? "animate-spin" : ""} />
                    </span>
                  </div>
                </div>
              </div>
              <Tooltip content="Close Details">
                <Drawer.Close asChild>
                  <button type="button" className="p-1.5 shrink-0 hover:bg-white/5 rounded-xl transition-[background-color,color,transform] duration-150 text-dim hover:text-text active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer" aria-label="Close Details">
                    <X size={14} />
                  </button>
                </Drawer.Close>
              </Tooltip>
            </div>
            <ModalAlertTicker />

            <TradeDetailContent
              trade={trade}
              isSyncing={showResumingFeedback}
              onTradeClose={handleForceClose}
              isClosing={isClosing}
              confirmClose={confirmClose}
              setConfirmClose={setConfirmClose}
              layout="modal"
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
})
TradeDetailModal.displayName = 'TradeDetailModal'
