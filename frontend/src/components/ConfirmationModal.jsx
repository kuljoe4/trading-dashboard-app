import React, { useRef, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, Btn, Tooltip } from './ui/primitives'

export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) => {
  const cancelBtnRef = useRef(null);

  // UX: Safe-by-default focus strategy. Auto-focus the non-destructive action (Cancel)
  // to prevent accidental data loss from rapid 'Enter' key presses.
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && !loading && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={cn("fixed inset-0 z-10100 bg-black/80 w-full h-full", loading ? "cursor-wait" : "cursor-pointer")}
              />
            </Dialog.Overlay>
            <Dialog.Content
                className="fixed bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 z-10110 outline-none w-full max-h-[85vh] md:fixed md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[calc(100%-2rem)] md:max-w-md"
            >
              <motion.div
                role="alertdialog"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-surface border border-border rounded-t-3xl rounded-b-none md:rounded-xl p-3.5 md:p-4 shadow-2xl overflow-hidden"
              >
                  <div className="flex justify-between items-center mb-2">
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center",
                      variant === 'danger' ? "bg-red/10 text-red" : "bg-accent/10 text-accent"
                    )}>
                      <AlertTriangle size={14} />
                    </div>
                    <Tooltip content="Close">
                      <Dialog.Close asChild disabled={loading}>
                        <button
                          type="button"
                          disabled={loading}
                          className="text-dim hover:text-text p-1 hover:bg-white/5 rounded-lg transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          aria-label="Close dialog"
                        >
                          <X size={14} />
                        </button>
                      </Dialog.Close>
                    </Tooltip>
                  </div>

                  <Dialog.Title className="text-sm font-bold mb-1">{title}</Dialog.Title>
                  <Dialog.Description className="text-[11px] text-dim leading-relaxed mb-3">
                    {message}
                  </Dialog.Description>

                  <div className="flex flex-col-reverse sm:flex-row gap-2">
                    <div className="flex-1">
                      <Dialog.Close asChild disabled={loading}>
                        <Btn
                          ref={cancelBtnRef}
                          type="button"
                          variant="ghost"
                          disabled={loading}
                          aria-label={`${cancelText} action`}
                          className="w-full h-9 py-1 text-[11px] cursor-pointer"
                        >
                          {cancelText}
                        </Btn>
                      </Dialog.Close>
                    </div>
                    <div className="flex-1">
                      <Btn
                        type="button"
                        variant={variant}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!loading) onConfirm();
                        }}
                        loading={loading}
                        disabled={loading}
                        aria-label={`${confirmText} action`}
                        className="w-full h-9 py-1 text-[11px] cursor-pointer"
                      >
                        {confirmText}
                      </Btn>
                    </div>
                  </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
