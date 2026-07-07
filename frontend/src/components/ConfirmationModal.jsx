import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, Btn, VisuallyHidden } from './ui/primitives'

export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) => {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <div className="fixed inset-0 z-[10100] bg-black/80 cursor-pointer">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full"
                />
              </div>
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10110] outline-none w-[calc(100%-2rem)] max-w-md">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  className="bg-surface border border-border rounded-2xl p-6 shadow-2xl overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      variant === 'danger' ? "bg-red/10 text-red" : "bg-accent/10 text-accent"
                    )}>
                      <AlertTriangle size={20} />
                    </div>
                    <Dialog.Close asChild>
                      <button
                        className="text-dim hover:text-text p-2 hover:bg-white/5 rounded-xl transition-all active:scale-90 outline-none"
                        aria-label="Close"
                      >
                        <X size={20} />
                      </button>
                    </Dialog.Close>
                  </div>

                  <Dialog.Title className="text-lg font-bold mb-2">{title}</Dialog.Title>
                  <Dialog.Description className="text-sm text-dim leading-relaxed mb-6">
                    {message}
                  </Dialog.Description>

                  <div className="flex gap-3">
                    <Dialog.Close asChild>
                      <div className="flex-1">
                        <Btn
                          variant="ghost"
                          disabled={loading}
                          className="w-full"
                        >
                          {cancelText}
                        </Btn>
                      </div>
                    </Dialog.Close>
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
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
