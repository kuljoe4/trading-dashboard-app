import React, { useEffect, useRef } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, Btn } from './ui/primitives'

export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) => {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure focus works after animation starts
      const timer = setTimeout(() => {
        cancelRef.current?.focus();
      }, 50);

      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      window.addEventListener('keydown', handleEscape);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="conf-modal-title"
          aria-describedby="conf-modal-desc"
        >
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
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl overflow-hidden"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                variant === 'danger' ? "bg-red/10 text-red" : "bg-accent/10 text-accent"
              )}>
                <AlertTriangle size={20} />
              </div>
              <button
                onClick={onClose}
                className="text-dim hover:text-text p-2 hover:bg-white/5 rounded-xl transition-all active:scale-90"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <h3 id="conf-modal-title" className="text-lg font-bold mb-2">{title}</h3>
            <p id="conf-modal-desc" className="text-sm text-dim leading-relaxed mb-6">{message}</p>

            <div className="flex gap-3">
              <Btn
                variant="ghost"
                onClick={onClose}
                disabled={loading}
                className="flex-1"
                ref={cancelRef}
              >
                {cancelText}
              </Btn>
              <Btn
                variant={variant}
                onClick={onConfirm}
                loading={loading}
                className="flex-1"
              >
                {confirmText}
              </Btn>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
