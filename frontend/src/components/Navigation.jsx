import React, { useState } from 'react'
import { LayoutDashboard, History, Settings as SettingsIcon, Activity, Zap, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTradingStore } from '../store/trading'
import { cn, PulseDot } from './ui/primitives'

export const Sidebar = ({ selected }) => {
  const { wsStatus, sidebarCollapsed: collapsed, toggleSidebar } = useTradingStore()
  
  const isActive = (path) => {
    if (path === '/') return !selected && window.location.hash === '#/'
    return window.location.hash.startsWith(`#${path}`)
  }

  const triggerScanner = () => window.dispatchEvent(new Event('open-scanner'))

  return (
    <div className={cn(
      "hidden lg:flex flex-col fixed left-0 top-0 bottom-0 bg-surface border-r border-border z-50 transition-all duration-300",
      collapsed ? "w-[80px] p-4" : "w-[260px] p-6"
    )}>
      <div className={cn("flex items-center gap-3 mb-12", collapsed && "justify-center")}>
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20 shrink-0">
          <LayoutDashboard size={24} className="text-white" />
        </div>
        {!collapsed && <span className="text-xl font-black tracking-tighter uppercase italic text-text whitespace-nowrap">Momentum</span>}
      </div>

      <nav className="flex-1 space-y-2">
        {[
          { path: '/', label: 'Cockpit', icon: LayoutDashboard },
          { path: '/history', label: 'History', icon: History },
          { path: '/settings', label: 'Settings', icon: SettingsIcon },
        ].map(item => (
          <button 
            key={item.path}
            onClick={() => window.location.hash = `#${item.path}`}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={cn(
              "w-full flex items-center gap-3 py-3 rounded-xl font-bold text-[13px] transition-all",
              collapsed ? "justify-center px-0" : "px-4",
              isActive(item.path) ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:bg-white/5 hover:text-text"
            )}
          >
            <item.icon size={20} className="shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
        
        <button 
          onClick={triggerScanner}
          aria-label="Market Scanner"
          title={collapsed ? "Market Scanner" : undefined}
          className={cn(
            "w-full flex items-center gap-3 py-3 rounded-xl font-bold text-[13px] transition-all text-accent hover:bg-accent/10",
            collapsed ? "justify-center px-0" : "px-4"
          )}
        >
          <Zap size={20} className="shrink-0" />
          {!collapsed && <span>Scanner</span>}
        </button>
      </nav>

      <button 
        onClick={toggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-8 w-6 h-6 bg-surface border border-border rounded-full flex items-center justify-center text-dim hover:text-text z-50"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {!collapsed && (
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
      )}
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
        aria-label="Cockpit"
        className={cn("flex flex-col items-center gap-2", isActive('/') ? "text-accent" : "text-dim hover:text-text")}
      >
        <LayoutDashboard size={24} />
      </button>
      <button 
        onClick={() => window.location.hash = '#/history'}
        aria-label="History"
        className={cn("flex flex-col items-center gap-2", isActive('/history') ? "text-accent" : "text-dim hover:text-text")}
      >
        <History size={24} />
      </button>
      <button 
        onClick={() => window.location.hash = '#/settings'}
        aria-label="Settings"
        className={cn("flex flex-col items-center gap-2", isActive('/settings') ? "text-accent" : "text-dim hover:text-text")}
      >
        <SettingsIcon size={24} />
      </button>
    </div>
  )
}
