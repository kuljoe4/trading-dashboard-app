import React from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, Btn } from './ui/primitives'

export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative bg-surface border border-border w-full max-w-md rounded-[2rem] p-8 shadow-2xl overflow-hidden z-[1001]"
      >
        <div className="flex justify-between items-start mb-4">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center",
            variant === 'danger' ? "bg-red/10 text-red" : "bg-accent/10 text-accent"
          )}>
            <AlertTriangle size={20} />
          </div>
          <button onClick={onClose} className="text-dim hover:text-text p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <p className="text-sm text-dim leading-relaxed mb-6">{message}</p>

        <div className="flex gap-3">
          <Btn variant="ghost" onClick={onClose} disabled={loading} className="flex-1">{cancelText}</Btn>
          <Btn variant={variant} onClick={onConfirm} loading={loading} className="flex-1">{confirmText}</Btn>
        </div>
      </motion.div>
    </div>
  );
}
