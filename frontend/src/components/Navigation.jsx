import React, { useState } from 'react'
import { SystemMetrics } from './SystemMetrics'
import { LayoutDashboard, Briefcase, History, Settings as SettingsIcon, ChevronLeft, ChevronRight, Zap, Plus, Keyboard } from 'lucide-react'
import { useTradingStore } from '../store/trading'
import { cn, Tooltip } from './ui/primitives'

const preloadView = (path) => {
  if (path === '/') import('../views/DashboardView');
  else if (path === '/trades') import('../views/TradesView');
  else if (path === '/history') import('../views/HistoryView');
  else if (path === '/settings') import('../views/SettingsView');
};

const NAV_ITEMS = [
  { path: '/', label: 'Cockpit', icon: LayoutDashboard, shortcut: '1/C' },
  { path: '/trades', label: 'Trades', icon: Briefcase, shortcut: '2/T' },
  { path: '/history', label: 'History', icon: History, shortcut: '3/H' },
  { path: '/settings', label: 'Settings', icon: SettingsIcon, shortcut: '4' },
]

export const Sidebar = ({ selected }) => {
  const { wsStatus, sidebarCollapsed: collapsed, toggleSidebar, monitoring, rateLimit, rateLimitLastSync, gateState, isEcoMode, isSyncing, sessionActive, activeTrades, config } = useTradingStore()
  const [isHovered, setIsHovered] = React.useState(false)
  const isExpanded = !collapsed || isHovered

  const isActive = (path) => {
    if (path === '/') {
      const h = window.location.hash;
      return h === '#/' || h === '' || h.startsWith('#/strategy/');
    }
    return window.location.hash.startsWith(`#${path}`)
  }

  const triggerScanner = () => window.dispatchEvent(new Event('toggle-scanner'))

  return (
    <div 
      onMouseEnter={() => collapsed && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "hidden lg:flex flex-col fixed left-0 top-0 bottom-0 bg-surface border-r border-border z-50 transition-all duration-300",
        isExpanded ? "w-[260px]" : "w-[80px]"
      )}
    >
      <div className={cn("flex-1 flex flex-col p-4 sm:p-5 overflow-hidden", !isExpanded && "px-3")}>
        <button
          type="button"
          onClick={() => { window.location.hash = '#/'; }}
          onMouseEnter={() => preloadView('/')}
          aria-label="Momentum Cockpit Home"
          className={cn("flex items-center gap-3 mb-8 text-left group/brand focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg cursor-pointer transition-opacity hover:opacity-95 relative", !isExpanded && "justify-center")}
        >
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-sm shrink-0 group-hover/brand:scale-105 transition-transform">
            <LayoutDashboard size={20} className="text-white" />
          </div>
          {isExpanded && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-extrabold tracking-tight uppercase text-text whitespace-nowrap">Momentum</span>
              <span className="text-[9px] font-mono font-medium text-dim tracking-wider uppercase">Trading Terminal</span>
            </div>
          )}
          {isSyncing && (
            <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-full">
              <div className="h-full bg-accent animate-progress-fast" />
            </div>
          )}
        </button>

      <nav className="flex-1 flex flex-col gap-1.5">
        {NAV_ITEMS.map(item => (
          <Tooltip key={item.path} content={collapsed ? `${item.label} [${item.shortcut}]` : null} side="right">
            <button
              type="button"
              onClick={() => window.location.hash = `#${item.path}`}
              onMouseEnter={() => preloadView(item.path)}
              aria-label={`${item.label}${item.path === '/trades' && activeTrades?.length > 0 ? ` (${activeTrades.length} active position${activeTrades.length === 1 ? '' : 's'})` : ''}${item.shortcut ? ` [${item.shortcut}]` : ''}`}
              aria-current={isActive(item.path) ? 'page' : undefined}
              className={cn(
                "group w-full flex flex-col items-center gap-1 py-2.5 rounded-lg font-semibold text-xs tracking-wide transition-all relative focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer",
                isExpanded ? "flex-row px-3 gap-3" : "justify-center px-0",
                isActive(item.path) ? "bg-accent text-white shadow-sm" : "text-dim hover:bg-white/[0.04] hover:text-text"
              )}
            >
              <div className="relative">
                <item.icon size={18} className="shrink-0" />
                {item.path === '/trades' && activeTrades?.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-accent text-white text-[8.5px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-surface shadow-xs">
                    {activeTrades.length}
                  </span>
                )}
              </div>
              {isExpanded && (
                <span className="flex-1 flex items-center justify-between">
                  <span>{item.label}</span>
                  <span className="ml-auto text-[9.5px] font-mono text-dim/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">[{item.shortcut}]</span>
                </span>
              )}
            </button>
          </Tooltip>
        ))}

        <Tooltip content={collapsed ? "Market Scanner [S]" : null} side="right">
          <button
            type="button"
            onClick={triggerScanner}
            aria-label="Market Scanner [S]"
            className={cn(
              "group w-full flex flex-col items-center gap-1 py-2.5 rounded-lg font-semibold text-xs tracking-wide transition-all text-accent hover:bg-accent/10 relative focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer",
              isExpanded ? "flex-row px-3 gap-3" : "justify-center px-0"
            )}
          >
            <Zap size={18} className="shrink-0" />
            {isExpanded && (
              <span className="flex-1 flex items-center justify-between">
                <span>Scanner</span>
                <span className="ml-auto text-[9.5px] font-mono text-dim/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">[S]</span>
              </span>
            )}
          </button>
        </Tooltip>

        <Tooltip content={!isExpanded ? "Keyboard Shortcuts [?]" : null} side="right">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('toggle-shortcuts'))}
            aria-label="Keyboard Shortcuts [?]"
            className={cn(
              "group w-full flex flex-col items-center gap-1 py-2.5 rounded-lg font-semibold text-xs tracking-wide transition-all text-dim hover:text-text hover:bg-white/[0.04] relative focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer",
              isExpanded ? "flex-row px-3 gap-3" : "justify-center px-0"
            )}
          >
            <Keyboard size={18} className="shrink-0" />
            {isExpanded && (
              <span className="flex-1 flex items-center justify-between">
                <span>Shortcuts</span>
                <span className="ml-auto text-[9.5px] font-mono text-dim/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">[?]</span>
              </span>
            )}
          </button>
        </Tooltip>
      </nav>

        <div className={cn(
          "pt-6 border-t border-border/50",
          !isExpanded ? "px-0" : "px-2"
        )}>
          <SystemMetrics monitoring={monitoring} rateLimit={rateLimit} rateLimitLastSync={rateLimitLastSync} wsStatus={wsStatus} gateState={gateState} isEcoMode={isEcoMode} activeTrades={activeTrades} config={config} compact={!isExpanded} />
        </div>
      </div>

      <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-4 top-8 w-8 h-8 bg-surface border border-border rounded-full flex items-center justify-center text-dim hover:text-text z-[60] shadow-md transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </Tooltip>
    </div>
  )
}

export const MobileHealthBar = () => {
  const { healthEnabled, monitoring, rateLimit, rateLimitLastSync, wsStatus, gateState, isEcoMode, activeTrades, config } = useTradingStore()
  if (!healthEnabled) return null

  return (
    <div className="lg:hidden bg-surface/30 px-4 py-3 border-b border-border/40">
      <SystemMetrics
        monitoring={monitoring}
        rateLimit={rateLimit}
        rateLimitLastSync={rateLimitLastSync}
        wsStatus={wsStatus}
        gateState={gateState}
        isEcoMode={isEcoMode}
        activeTrades={activeTrades}
        config={config}
        compact={true}
      />
    </div>
  )
}

export const BottomNav = ({ selected }) => {
  const { wsStatus, monitoring, rateLimit, rateLimitLastSync, gateState, isEcoMode, healthEnabled, isSyncing, activeTrades } = useTradingStore()
  const isActive = (path) => {
    if (path === '/') {
      const h = window.location.hash;
      return h === '#/' || h === '' || h.startsWith('#/strategy/');
    }
    return window.location.hash.startsWith(`#${path}`)
  }

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur-md border-t border-border z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      {isSyncing && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full bg-accent animate-progress-fast" />
        </div>
      )}
      <MobileHealthBar />
      <div className="flex justify-around items-center h-16">
        {[
          { path: '/', label: 'Cockpit', icon: LayoutDashboard },
          { path: '/trades', label: 'Trades', icon: Briefcase },
          { path: '/history', label: 'History', icon: History },
          { path: '/settings', label: 'Settings', icon: SettingsIcon },
        ].map(item => (
          <button
            key={item.path}
            type="button"
            onClick={() => window.location.hash = `#${item.path}`}
            onMouseEnter={() => preloadView(item.path)}
            aria-label={item.path === '/trades' && activeTrades?.length > 0 ? `${item.label} (${activeTrades.length} active position${activeTrades.length === 1 ? '' : 's'})` : item.label}
            aria-current={isActive(item.path) ? 'page' : undefined}
            className={cn(
              "flex flex-col items-center justify-center w-full h-full gap-1 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer rounded-lg",
              isActive(item.path) ? "text-accent" : "text-dim hover:text-text"
            )}
          >
            <div className="relative">
              <item.icon size={20} />
              {item.path === '/trades' && activeTrades?.length > 0 && (
                <span className="absolute -top-1.5 -right-2 bg-accent text-white text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center border border-surface shadow-sm animate-in zoom-in duration-300">
                  {activeTrades.length}
                </span>
              )}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
