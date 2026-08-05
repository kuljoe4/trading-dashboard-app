import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Keyboard } from 'lucide-react'
import { cn, Tooltip, VisuallyHidden } from './ui/primitives'

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['1', 'C'], label: 'Go to Cockpit View' },
      { keys: ['2', 'T'], label: 'Go to Active Positions' },
      { keys: ['3', 'H'], label: 'Go to Trade History' },
      { keys: ['4'], label: 'Go to System Settings' },
    ]
  },
  {
    title: 'Global Actions',
    shortcuts: [
      { keys: ['S'], label: 'Toggle Live Scanner' },
      { keys: ['/'], label: 'Focus & Select Search Input' },
      { keys: ['?'], label: 'Toggle Keyboard Cheatsheet' },
      { keys: ['Esc'], label: 'Close Active Dialog / Blur input' },
    ]
  }
]

export const ShortcutsModal = ({ isOpen, onClose }) => {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-md z-[10100] animate-in fade-in duration-300" />
        <Dialog.Content
          aria-labelledby="shortcuts-title"
          aria-describedby="shortcuts-description"
          className="fixed bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 w-full rounded-t-3xl rounded-b-none max-h-[85vh] md:fixed md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md md:rounded-2xl bg-surface/95 border border-border/50 p-5 md:p-6 shadow-2xl backdrop-blur-xl z-[10110] animate-in fade-in zoom-in-95 duration-300 focus:outline-none"
        >
          <Dialog.Title asChild>
            <VisuallyHidden>Keyboard Shortcuts Cheatsheet</VisuallyHidden>
          </Dialog.Title>
          <Dialog.Description asChild>
            <VisuallyHidden>List of keyboard shortcuts to navigate and control the Momentum Engine dashboard.</VisuallyHidden>
          </Dialog.Description>

          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                <Keyboard size={18} />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest">Keyboard Shortcuts</h3>
                <p className="text-[9px] text-dim font-bold uppercase tracking-wider">Boost your trading workflow</p>
              </div>
            </div>
            <Tooltip content="Close [Esc]">
              <Dialog.Close asChild>
                <button
                  className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-dim hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  aria-label="Close shortcuts dialog"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </Tooltip>
          </div>

          <div className="space-y-6">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title} className="space-y-3">
                <div className="text-[10px] text-dim font-black uppercase tracking-[0.15em] border-b border-border/30 pb-1.5">
                  {group.title}
                </div>
                <div className="space-y-2.5">
                  {group.shortcuts.map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-dim/80 font-medium">{s.label}</span>
                      <div className="flex items-center gap-1">
                        {s.keys.map((key, kIdx) => (
                          <React.Fragment key={kIdx}>
                            {kIdx > 0 && <span className="text-[9px] text-dim/40 font-bold uppercase px-0.5">or</span>}
                            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-background border border-border/80 font-mono text-[10px] font-black text-accent shadow-sm uppercase tracking-tight">
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 pt-4 border-t border-border/30 flex justify-end">
            <Dialog.Close asChild>
              <button
                className="px-5 py-2 bg-accent text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all active:scale-95 h-9"
              >
                Got It
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
