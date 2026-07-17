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
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[10100] bg-black/80 cursor-pointer w-full h-full"
              />
            </Dialog.Overlay>
            <Dialog.Content
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10110] outline-none w-[calc(100%-2rem)] max-w-md"
            >
              <motion.div
                role="alertdialog"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-surface border border-border rounded-xl p-3.5 md:p-4 shadow-2xl overflow-hidden"
              >
                  <div className="flex justify-between items-center mb-2">
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center",
                      variant === 'danger' ? "bg-red/10 text-red" : "bg-accent/10 text-accent"
                    )}>
                      <AlertTriangle size={14} />
                    </div>
                    <Tooltip content="Close">
                      <Dialog.Close asChild>
                        <button
                          className="text-dim hover:text-text p-1 hover:bg-white/5 rounded-lg transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
                      <Dialog.Close asChild>
                        <Btn
                          ref={cancelBtnRef}
                          variant="ghost"
                          disabled={loading}
                          className="w-full h-9 py-1 text-[11px]"
                        >
                          {cancelText}
                        </Btn>
                      </Dialog.Close>
                    </div>
                    <div className="flex-1">
                      <Btn
                        variant={variant}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onConfirm();
                        }}
                        loading={loading}
                        className="w-full h-9 py-1 text-[11px]"
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
