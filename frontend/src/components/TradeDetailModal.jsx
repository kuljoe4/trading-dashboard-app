import React, { useState, useEffect, memo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn, CopyButton, VisuallyHidden, Tooltip } from './ui/primitives'
import { formatDuration } from '../lib/formatters'
import { TradeDetailContent } from './trade/TradeDetailContent'
import { useTradingStore } from '../store/trading'
import { RefreshCw } from 'lucide-react'

export const TradeDetailModal = memo(({ trade, isOpen, onClose, onTradeClose }) => {
  const [now, setNow] = useState(Date.now())
  const [isClosing, setIsClosing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const { addAlert, isThrottled, wsStatus, isSyncingOnResume, sessionActive } = useTradingStore(state => ({
    addAlert: state.addAlert,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume,
    sessionActive: state.sessionActive
  }));

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;

  useEffect(() => {
    if (!isOpen) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(timer)
      setConfirmClose(false) // Reset confirm state when modal closes
    }
  }, [isOpen])

  const duration = React.useMemo(() => {
    if (!trade?.entry_ts) return '---'
    const start = new Date(trade.entry_ts).getTime()
    return formatDuration(now - start)
  }, [trade?.entry_ts, now])

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
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[90vh] overflow-y-auto no-scrollbar bg-surface/95 border border-border/50 rounded-[2.5rem] p-8 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[101] animate-in fade-in zoom-in-95 duration-300 focus:outline-none">
          <VisuallyHidden>
            <Dialog.Description>
              Detailed view of the active trade for {trade.symbol}, including P&L, duration, and exit signals.
            </Dialog.Description>
          </VisuallyHidden>
          <Dialog.Title className="flex items-center justify-between mb-8 sticky -top-8 bg-surface/10 backdrop-blur-sm z-20 pb-4 pt-4">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-14 h-14 rounded-3xl flex items-center justify-center shadow-2xl transition-transform duration-500 hover:scale-105",
                isLong ? "bg-green/10 text-green shadow-green/20" : "bg-red/10 text-red shadow-red/20"
              )}>
                {isLong ? <ArrowUpRight size={28} /> : <ArrowDownRight size={28} />}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black tracking-tighter">{trade.symbol}</span>
                  <CopyButton value={trade.symbol} className="opacity-40 hover:opacity-100" />
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                  {showResumingFeedback ? (
                    <span className="text-accent flex items-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin" /> Resuming Feed...
                    </span>
                  ) : (
                    <>
                      <span className={cn("px-2 py-0.5 rounded-full", isLong ? 'bg-green/10 text-green' : 'bg-red/10 text-red')}>
                        {trade.direction}
                      </span>
                      <span className="text-dim/30">•</span>
                      <span className="text-dim flex items-center gap-1.5">
                        <Clock size={12} className="text-accent" /> {duration}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <Tooltip content="Close Details">
              <Dialog.Close asChild>
                <button className="p-3 hover:bg-white/5 rounded-2xl transition-all text-dim hover:text-text active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none" aria-label="Close Details">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </Tooltip>
          </Dialog.Title>

          <TradeDetailContent 
            trade={trade}
            isSyncing={false}
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
