import React, { useRef, useEffect, useId } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, Btn, VisuallyHidden, Tooltip } from './ui/primitives'

export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) => {
  const cancelBtnRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

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
            <Dialog.Content asChild>
              <motion.div
                role="alertdialog"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10110] outline-none w-[calc(100%-2rem)] max-w-md bg-surface border border-border rounded-2xl p-6 shadow-2xl overflow-hidden"
              >
                  <div className="flex justify-between items-start mb-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      variant === 'danger' ? "bg-red/10 text-red" : "bg-accent/10 text-accent"
                    )}>
                      <AlertTriangle size={20} />
                    </div>
                    <Tooltip content="Close">
                      <Dialog.Close asChild>
                        <button
                          className="text-dim hover:text-text p-2 hover:bg-white/5 rounded-xl transition-all active:scale-90 outline-none"
                          aria-label="Close"
                        >
                          <X size={20} />
                        </button>
                      </Dialog.Close>
                    </Tooltip>
                  </div>

                  <Dialog.Title id={titleId} className="text-lg font-bold mb-2">{title}</Dialog.Title>
                  <Dialog.Description id={descriptionId} className="text-sm text-dim leading-relaxed mb-6">
                    {message}
                  </Dialog.Description>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Dialog.Close asChild>
                        <Btn
                          ref={cancelBtnRef}
                          variant="ghost"
                          disabled={loading}
                          className="w-full"
                        >
                          {cancelText}
                        </Btn>
                      </Dialog.Close>
                    </div>
                    <Btn
                      variant={variant}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onConfirm();
                      }}
                      loading={loading}
                      className="flex-1"
                    >
                      {confirmText}
                    </Btn>
                  </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
