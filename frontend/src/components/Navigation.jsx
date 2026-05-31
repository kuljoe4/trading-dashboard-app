import React, { useState } from 'react'
import { SystemMetrics } from './SystemMetrics'
import { LayoutDashboard, History, Settings as SettingsIcon, ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import { useTradingStore } from '../store/trading'
import { cn, Tooltip } from './ui/primitives'

export const Sidebar = ({ selected }) => {
  const { wsStatus, sidebarCollapsed: collapsed, toggleSidebar, monitoring, rateLimit, gateState, isEcoMode } = useTradingStore()
  const [isHovered, setIsHovered] = React.useState(false)
  const isExpanded = !collapsed || isHovered

  const isActive = (path) => {
    if (path === '/') return !selected && window.location.hash === '#/'
    return window.location.hash.startsWith(`#${path}`)
  }

  const triggerScanner = () => window.dispatchEvent(new Event('toggle-scanner'))

  return (
    <div 
      onMouseEnter={() => collapsed && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "hidden lg:flex flex-col fixed left-0 top-0 bottom-0 bg-surface border-r border-border z-50 transition-all duration-300 overflow-hidden",
        isExpanded ? "w-[260px] p-6" : "w-[80px] p-4"
      )}
    >
      <div className={cn("flex items-center gap-3 mb-12", !isExpanded && "justify-center")}>
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20 shrink-0">
          <LayoutDashboard size={24} className="text-white" />
        </div>
        {isExpanded && <span className="text-xl font-black tracking-tighter uppercase italic text-text whitespace-nowrap">Momentum</span>}
      </div>

      <nav className="flex-1 space-y-2">
        {[
          { path: '/', label: 'Cockpit', icon: LayoutDashboard, shortcut: '1/C' },
          { path: '/history', label: 'History', icon: History, shortcut: '2/H' },
          { path: '/settings', label: 'Settings', icon: SettingsIcon, shortcut: '3' },
        ].map(item => (
          <Tooltip key={item.path} content={`${item.label} [${item.shortcut}]`} side="right">
            <button
              onClick={() => window.location.hash = `#${item.path}`}
              aria-label={`${item.label} [${item.shortcut}]`}
              className={cn(
                "w-full flex items-center gap-3 py-3 rounded-xl font-bold text-[13px] transition-all",
                !isExpanded ? "justify-center px-0" : "px-4",
                isActive(item.path) ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:bg-white/5 hover:text-text"
              )}
            >
              <item.icon size={20} className="shrink-0" />
              {isExpanded && <span>{item.label}</span>}
            </button>
          </Tooltip>
        ))}

        <Tooltip content="Market Scanner [S]" side="right">
          <button 
            onClick={triggerScanner}
            aria-label="Market Scanner [S]"
            className={cn(
              "w-full flex items-center gap-3 py-3 rounded-xl font-bold text-[13px] transition-all text-accent hover:bg-accent/10",
              !isExpanded ? "justify-center px-0" : "px-4"
            )}
          >
            <Zap size={20} className="shrink-0" />
            {isExpanded && <span>Scanner</span>}
          </button>
        </Tooltip>
      </nav>

      <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
        <button 
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-4 top-8 w-8 h-8 bg-surface border border-border rounded-full flex items-center justify-center text-dim hover:text-text z-50 shadow-md"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </Tooltip>

      <div className={cn(
        "pt-6 border-t border-border/50",
        !isExpanded ? "px-0" : "px-2"
      )}>
        <SystemMetrics monitoring={monitoring} rateLimit={rateLimit} wsStatus={wsStatus} gateState={gateState} isEcoMode={isEcoMode} compact={!isExpanded} />
      </div>
    </div>
  )
}

export const BottomNav = ({ selected }) => {
  const { wsStatus, monitoring, rateLimit, gateState, isEcoMode } = useTradingStore()
  const isActive = (path) => {
    if (path === '/') return !selected && window.location.hash === '#/'
    return window.location.hash.startsWith(`#${path}`)
  }

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-md border-t border-border z-40">
      <div className="flex justify-around items-center px-8 py-5">
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
      <div className="px-4 pb-2 border-t border-border/40 flex justify-center pt-2">
        <SystemMetrics monitoring={monitoring} rateLimit={rateLimit} wsStatus={wsStatus} gateState={gateState} isEcoMode={isEcoMode} compact={true} />
      </div>
    </div>
  )
}
