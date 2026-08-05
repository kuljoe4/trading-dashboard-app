import React, { useState, useEffect, memo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn, CopyButton, VisuallyHidden, Tooltip, ModalAlertTicker } from './ui/primitives'
import { formatDuration } from '../lib/formatters'
import { TradeDetailContent } from './trade/TradeDetailContent'
import { useTradingStore } from '../store/trading'
import { RefreshCw } from 'lucide-react'

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
  const showResumingFeedback = sessionActive && isResuming;

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
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] animate-in fade-in duration-300" />
        <Dialog.Content 
          aria-labelledby="modal-title"
          aria-describedby="modal-description"
          className="fixed bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 w-full rounded-t-3xl rounded-b-none max-h-[85vh] md:fixed md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-3xl md:max-h-[90vh] md:rounded-xl overflow-y-auto no-scrollbar bg-surface/95 border border-border/50 p-3.5 md:p-5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[101] animate-in fade-in zoom-in-95 duration-300 focus:outline-none">
          <VisuallyHidden>
            <Dialog.Description id="modal-description">
              Detailed view of the active trade for {trade.symbol}, including P&L and exit signals.
            </Dialog.Description>
          </VisuallyHidden>
          <div className="flex items-center justify-between mb-3 sticky -top-5 bg-surface/80 backdrop-blur-sm z-20 pb-2 pt-2">
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center shadow-md transition-transform duration-500 hover:scale-105",
                isLong ? "bg-green/10 text-green shadow-green/20" : "bg-red/10 text-red shadow-red/20"
              )}>
                {isLong ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <Dialog.Title asChild>
                    <h2 id="modal-title" className="text-base font-black tracking-tighter">{trade.symbol}</h2>
                  </Dialog.Title>
                  <CopyButton value={trade.symbol} className="opacity-40 hover:opacity-100" />
                </div>
                <div className="flex items-center gap-1.5 text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] flex-wrap">
                  {showResumingFeedback ? (
                    <span className="text-accent flex items-center gap-1">
                      <RefreshCw size={9} className="animate-spin" /> Resuming Feed...
                    </span>
                  ) : (
                    <>
                      <span className={cn("px-1 py-0.5 rounded-full", isLong ? 'bg-green/10 text-green' : 'bg-red/10 text-red')}>
                        {trade.direction}
                      </span>
                      {trade.strategy_label && (
                        <span className="text-dim/80 font-bold lowercase tracking-normal">
                          via {trade.strategy_label}
                        </span>
                      )}
                      {trade.strategy_label && config && (
                        trade.strategy_label === (config.strategy_label || 'Momentum Strategy') ? (
                          <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[7px] md:text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-tighter shrink-0 normal-case">
                            Base
                          </span>
                        ) : (
                          <span className="bg-purple/10 text-purple border border-purple/20 text-[7px] md:text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-tighter shrink-0 normal-case">
                            Variant
                          </span>
                        )
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <Tooltip content="Close Details">
              <Dialog.Close asChild>
                <button className="p-1.5 hover:bg-white/5 rounded-xl transition-all text-dim hover:text-text active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none" aria-label="Close Details">
                  <X size={14} />
                </button>
              </Dialog.Close>
            </Tooltip>
          </div>
          <ModalAlertTicker />

          <TradeDetailContent 
            trade={trade}
            isSyncing={isResuming}
            onTradeClose={handleForceClose}
            isClosing={isClosing}
            confirmClose={confirmClose}
            setConfirmClose={setConfirmClose}
            layout="modal"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
TradeDetailModal.displayName = 'TradeDetailModal'
