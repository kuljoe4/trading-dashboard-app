import React from 'react'
import { LayoutDashboard, History, Settings as SettingsIcon, Activity } from 'lucide-react'
import { useTradingStore } from '../store/trading'
import { cn, PulseDot } from './ui/primitives'

export const Sidebar = ({ selected }) => {
  const { wsStatus } = useTradingStore()
  
  const isActive = (path) => {
    if (path === '/') return !selected && window.location.hash === '#/'
    return window.location.hash.startsWith(`#${path}`)
  }

  return (
    <div className="hidden lg:flex flex-col w-[260px] fixed left-0 top-0 bottom-0 bg-surface border-r border-border z-50 p-6">
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
          <LayoutDashboard size={24} className="text-white" />
        </div>
        <span className="text-xl font-black tracking-tighter uppercase italic text-text">Momentum</span>
      </div>

      <nav className="flex-1 space-y-2">
        <button 
          onClick={() => window.location.hash = '#/'}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-[13px] transition-all",
            isActive('/') ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:bg-white/5 hover:text-text"
          )}
        >
          <LayoutDashboard size={20} /> Cockpit
        </button>
        <button 
          onClick={() => window.location.hash = '#/history'}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-[13px] transition-all",
            isActive('/history') ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:bg-white/5 hover:text-text"
          )}
        >
          <History size={20} /> History
        </button>
        <button 
          onClick={() => window.location.hash = '#/settings'}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-[13px] transition-all",
            isActive('/settings') ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:bg-white/5 hover:text-text"
          )}
        >
          <SettingsIcon size={20} /> Settings
        </button>
      </nav>

      <div className="pt-6 border-t border-border/50">
        <div className="flex items-center gap-3 p-4 bg-background/50 rounded-2xl border border-border">
          <div className="flex-1">
            <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Live Status</div>
            <div className="flex items-center gap-2">
              <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
              <span className={cn("text-xs font-bold", wsStatus === 'live' ? "text-green" : "text-amber")}>
                {wsStatus === 'live' ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const BottomNav = ({ selected }) => {
  const isActive = (path) => {
    if (path === '/') return !selected && window.location.hash === '#/'
    return window.location.hash.startsWith(`#${path}`)
  }

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-md border-t border-border px-8 py-5 flex justify-around items-center z-40">
      <button 
        onClick={() => window.location.hash = '#/'}
        className={cn("flex flex-col items-center gap-2", isActive('/') ? "text-accent" : "text-dim hover:text-text")}
      >
        <LayoutDashboard size={24} />
        <span className="text-[10px] font-bold uppercase tracking-widest">Cockpit</span>
      </button>
      <button 
        onClick={() => window.location.hash = '#/history'}
        className={cn("flex flex-col items-center gap-2", isActive('/history') ? "text-accent" : "text-dim hover:text-text")}
      >
        <History size={24} />
        <span className="text-[10px] font-bold uppercase tracking-widest">History</span>
      </button>
      <button 
        onClick={() => window.location.hash = '#/settings'}
        className={cn("flex flex-col items-center gap-2", isActive('/settings') ? "text-accent" : "text-dim hover:text-text")}
      >
        <SettingsIcon size={24} />
        <span className="text-[10px] font-bold uppercase tracking-widest">Settings</span>
      </button>
    </div>
  )
}
