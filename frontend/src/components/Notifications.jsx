import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { X, CheckCircle2, AlertCircle, Info, Loader2 } from 'lucide-react'
import { cn } from './ui/primitives'

export const Notifications = () => {
  const { notifications, removeNotification } = useTradingStore()

  return (
    <div className="fixed top-6 right-6 z-[200] flex flex-col gap-3 w-full max-w-[320px] pointer-events-none">
      <AnimatePresence mode="popLayout">
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            className={cn(
              "p-4 rounded-2xl border shadow-2xl backdrop-blur-xl pointer-events-auto flex items-start gap-3",
              n.type === 'error' ? "bg-red/10 border-red/20 text-red" :
              n.type === 'success' ? "bg-green/10 border-green/20 text-green" :
              "bg-surface/80 border-border text-text"
            )}
          >
            <div className="mt-0.5 shrink-0">
              {n.type === 'error' ? <AlertCircle size={18} /> :
               n.type === 'success' ? <CheckCircle2 size={18} /> :
               n.loading ? <Loader2 size={18} className="animate-spin text-accent" /> :
               <Info size={18} className="text-accent" />}
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-tight">{n.title}</div>
              {n.message && <div className="text-[10px] text-dim font-medium mt-1 leading-relaxed">{n.message}</div>}
            </div>
            <button
              onClick={() => removeNotification(n.id)}
              className="p-1 hover:bg-white/5 rounded-lg transition-colors text-dim hover:text-text"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
