import React, { useState, useEffect } from 'react'
import { SystemMetrics } from './SystemMetrics'
import { LayoutDashboard, Briefcase, History, Settings as SettingsIcon, ChevronLeft, ChevronRight, Zap, Plus, Keyboard } from 'lucide-react'
import { useTradingStore } from '../store/trading'
import { cn, Tooltip } from './ui/primitives'
import { MotionSegmentedPill } from './ui/SmoothMotion'

const preloadView = (path) => {
  if (path === '/') {
    import('../views/DashboardView');
    import('../views/StrategyDetailView');
  } else if (path === '/trades') {
    import('../views/TradesView');
    import('../views/TradeDetailView');
  } else if (path === '/history') {
    import('../views/HistoryView');
  } else if (path === '/settings') {
    import('../views/SettingsView');
  }
};

const useActiveHash = (activeRoute) => {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : '#/'));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHashChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (path) => {
    if (activeRoute) {
      if (path === '/') return activeRoute === 'cockpit' || activeRoute === 'dashboard' || activeRoute.startsWith('strategy/');
      if (path === '/trades') return activeRoute === 'trades' || activeRoute.startsWith('trade/');
      return activeRoute === path.slice(1) || activeRoute.startsWith(`${path.slice(1)}/`);
    }
    if (path === '/') {
      return hash === '#/' || hash === '' || hash.startsWith('#/strategy/');
    }
    if (path === '/trades') {
      return hash.startsWith('#/trades') || hash.startsWith('#/trade/');
    }
    return hash.startsWith(`#${path}`);
  };
};

const NAV_ITEMS = [
  { path: '/', label: 'Cockpit', icon: LayoutDashboard, shortcut: '1/C' },
  { path: '/trades', label: 'Trades', icon: Briefcase, shortcut: '2/T' },
  { path: '/history', label: 'History', icon: History, shortcut: '3/H' },
  { path: '/settings', label: 'Settings', icon: SettingsIcon, shortcut: '4' },
]

export const Sidebar = ({ selected, activeRoute }) => {
  const { wsStatus, sidebarCollapsed: collapsed, toggleSidebar, monitoring, rateLimit, rateLimitLastSync, apiStatus, gateState, isEcoMode, isSyncing, sessionActive, activeTrades, config } = useTradingStore()
  const [isHovered, setIsHovered] = React.useState(false)
  const isExpanded = !collapsed || isHovered
  const isActive = useActiveHash(activeRoute)

  const triggerScanner = () => window.dispatchEvent(new Event('toggle-scanner'))

  return (
    <div 
      onMouseEnter={() => collapsed && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "hidden lg:flex flex-col fixed left-0 top-0 bottom-0 bg-surface border-r border-border z-50 transition-[width] duration-300 ease-[var(--ease-glide)] will-change-[width]",
        isExpanded ? "w-[260px]" : "w-[80px]"
      )}
    >
      <div className="flex-1 flex flex-col p-4 overflow-y-auto overflow-x-hidden min-h-0">
        <button
          type="button"
          onClick={() => { window.location.hash = '#/'; }}
          onMouseEnter={() => preloadView('/')}
          onFocus={() => preloadView('/')}
          aria-label="Momentum Cockpit Home"
          className="flex items-center mb-8 text-left group/brand focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl cursor-pointer transition-opacity duration-200 hover:opacity-95 relative shrink-0 w-full overflow-hidden"
        >
          <div className="w-12 h-10 shrink-0 flex items-center justify-center">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-sm shrink-0 group-hover/brand:scale-105 transition-transform duration-200 ease-[var(--ease-out-expo)]">
              <LayoutDashboard size={20} className="text-white" />
            </div>
          </div>
          <div
            className={cn(
              "flex flex-col min-w-0 pr-2 transition-[opacity,transform] duration-200 ease-[var(--ease-out-expo)]",
              isExpanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1.5 pointer-events-none"
            )}
          >
            <span className="text-sm font-extrabold tracking-tight uppercase text-text whitespace-nowrap">Momentum</span>
            <span className="text-[9px] font-mono font-medium text-dim tracking-wider uppercase whitespace-nowrap">Trading Terminal</span>
          </div>
          {isSyncing && (
            <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-full">
              <div className="h-full bg-accent animate-progress-fast" />
            </div>
          )}
        </button>

      <nav className="flex flex-col gap-1.5 shrink-0">
        {NAV_ITEMS.map(item => {
          const active = isActive(item.path)
          return (
            <Tooltip key={item.path} content={collapsed ? `${item.label} [${item.shortcut}]` : null} side="right">
              <button
                type="button"
                onClick={() => window.location.hash = `#${item.path}`}
                onMouseEnter={() => preloadView(item.path)}
                onFocus={() => preloadView(item.path)}
                onTouchStart={() => preloadView(item.path)}
                aria-label={`${item.label}${item.path === '/trades' && activeTrades?.length > 0 ? ` (${activeTrades.length} active position${activeTrades.length === 1 ? '' : 's'})` : ''}${item.shortcut ? ` [${item.shortcut}]` : ''}`}
                aria-current={isActive(item.path) ? 'page' : undefined}
                className={cn(
                  "group w-full flex items-center py-2.5 rounded-xl font-semibold text-xs tracking-wide transition-colors duration-200 ease-[var(--ease-out-expo)] relative overflow-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer",
                  active ? "text-white" : "text-dim hover:bg-white/[0.04] hover:text-text"
                )}
              >
                {active && (
                  <MotionSegmentedPill
                    layoutId="sidebar-active-nav"
                    className="rounded-xl bg-accent shadow-sm z-0"
                  />
                )}
                <div className="relative z-10 w-12 h-5 shrink-0 flex items-center justify-center">
                  <div className="relative">
                    <item.icon size={18} className="shrink-0" />
                    {item.path === '/trades' && activeTrades?.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-accent text-white text-[8.5px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-surface shadow-xs">
                        {activeTrades.length}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "relative z-10 flex-1 flex items-center justify-between pr-3 whitespace-nowrap min-w-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out-expo)]",
                    isExpanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1.5 pointer-events-none"
                  )}
                >
                  <span>{item.label}</span>
                  <span className={cn(
                    "ml-auto text-[9.5px] font-mono opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150",
                    active ? "text-white/80" : "text-dim/60"
                  )}>[{item.shortcut}]</span>
                </span>
              </button>
            </Tooltip>
          )
        })}

        <Tooltip content={collapsed ? "Market Scanner [S]" : null} side="right">
          <button
            type="button"
            onClick={triggerScanner}
            aria-label="Market Scanner [S]"
            className="group w-full flex items-center py-2.5 rounded-xl font-semibold text-xs tracking-wide transition-colors duration-200 ease-[var(--ease-out-expo)] text-accent hover:bg-accent/10 relative overflow-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
          >
            <span className="w-12 h-5 shrink-0 flex items-center justify-center">
              <Zap size={18} className="shrink-0" />
            </span>
            <span
              className={cn(
                "flex-1 flex items-center justify-between pr-3 whitespace-nowrap min-w-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out-expo)]",
                isExpanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1.5 pointer-events-none"
              )}
            >
              <span>Scanner</span>
              <span className="ml-auto text-[9.5px] font-mono text-dim/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">[S]</span>
            </span>
          </button>
        </Tooltip>

        <Tooltip content={!isExpanded ? "Keyboard Shortcuts [?]" : null} side="right">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('toggle-shortcuts'))}
            aria-label="Keyboard Shortcuts [?]"
            className="group w-full flex items-center py-2.5 rounded-xl font-semibold text-xs tracking-wide transition-colors duration-200 ease-[var(--ease-out-expo)] text-dim hover:text-text hover:bg-white/[0.04] relative overflow-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
          >
            <span className="w-12 h-5 shrink-0 flex items-center justify-center">
              <Keyboard size={18} className="shrink-0" />
            </span>
            <span
              className={cn(
                "flex-1 flex items-center justify-between pr-3 whitespace-nowrap min-w-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out-expo)]",
                isExpanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1.5 pointer-events-none"
              )}
            >
              <span>Shortcuts</span>
              <span className="ml-auto text-[9.5px] font-mono text-dim/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">[?]</span>
            </span>
          </button>
        </Tooltip>
      </nav>

        <div className={cn(
          "mt-auto pt-6 border-t border-border/50 shrink-0 transition-[padding] duration-300 ease-[var(--ease-glide)]",
          !isExpanded ? "px-0" : "px-2"
        )}>
          <SystemMetrics monitoring={monitoring} rateLimit={rateLimit} rateLimitLastSync={rateLimitLastSync} apiStatus={apiStatus} wsStatus={wsStatus} gateState={gateState} isEcoMode={isEcoMode} activeTrades={activeTrades} config={config} compact={!isExpanded} />
        </div>
      </div>

      <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-4 top-8 w-8 h-8 bg-surface border border-border rounded-full flex items-center justify-center text-dim hover:text-text z-[60] shadow-md transition-[transform,color,border-color] duration-200 ease-[var(--ease-out-expo)] active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </Tooltip>
    </div>
  )
}

export const MobileHealthBar = () => {
  const { healthEnabled, monitoring, rateLimit, rateLimitLastSync, apiStatus, wsStatus, gateState, isEcoMode, activeTrades, config } = useTradingStore()
  if (!healthEnabled) return null

  return (
    <div className="lg:hidden bg-surface/40 px-2.5 py-1 border-b border-border/40 min-h-[28px] flex items-center justify-center">
      <SystemMetrics
        monitoring={monitoring}
        rateLimit={rateLimit}
        rateLimitLastSync={rateLimitLastSync}
        apiStatus={apiStatus}
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

export const BottomNav = ({ selected, activeRoute }) => {
  const { isSyncing, activeTrades } = useTradingStore()
  const isActive = useActiveHash(activeRoute)

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur-md border-t border-border z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      {isSyncing && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full bg-accent animate-progress-fast" />
        </div>
      )}
      <MobileHealthBar />
      <div className="flex justify-around items-center h-14 px-1.5">
        {[
          { path: '/', label: 'Cockpit', icon: LayoutDashboard },
          { path: '/trades', label: 'Trades', icon: Briefcase },
          { path: '/history', label: 'History', icon: History },
          { path: '/settings', label: 'Settings', icon: SettingsIcon },
        ].map(item => {
          const active = isActive(item.path)
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => window.location.hash = `#${item.path}`}
              onMouseEnter={() => preloadView(item.path)}
              onFocus={() => preloadView(item.path)}
              onTouchStart={() => preloadView(item.path)}
              aria-label={item.path === '/trades' && activeTrades?.length > 0 ? `${item.label} (${activeTrades.length} active position${activeTrades.length === 1 ? '' : 's'})` : item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                "relative overflow-hidden flex flex-col items-center justify-center w-full h-11 gap-1 transition-colors duration-200 ease-[var(--ease-out-expo)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer rounded-xl",
                active ? "text-accent" : "text-dim hover:text-text"
              )}
            >
              {active && (
                <MotionSegmentedPill
                  layoutId="bottom-nav-active"
                  className="rounded-xl bg-accent/10 z-0"
                />
              )}
              <div className="relative z-10">
                <item.icon size={20} />
                {item.path === '/trades' && activeTrades?.length > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-accent text-white text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center border border-surface shadow-sm">
                    {activeTrades.length}
                  </span>
                )}
              </div>
              <span className="relative z-10 text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

