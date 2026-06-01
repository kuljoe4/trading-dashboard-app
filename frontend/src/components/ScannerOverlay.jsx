import React from 'react'
import { fmtVol } from '../lib/theme'
import { PulseDot, Sparkline, cn } from './ui/primitives'
import { useTradingStore } from '../store/trading'
import { X, Search, ShieldCheck } from 'lucide-react'

export const ScannerOverlay = React.memo(({ onClose }) => {
  const { scannerResults, activeWindows, config, scannerPaused, gateState } = useTradingStore(state => ({
    scannerResults: state.scannerResults,
    activeWindows: state.activeWindows,
    config: state.config,
    scannerPaused: state.scannerPaused,
    gateState: state.gateState,
  }))
  const threshold = config.scan_pct_threshold || 2.0

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden">
      <div className="p-4 border-b border-border flex justify-between items-center shrink-0 h-[64px]">
        <div className="flex items-center gap-2.5">
          <PulseDot color="bg-green" />
          <span className="text-[14px] font-bold">Live Scanner</span>
          <span className="text-[10px] text-dim font-medium uppercase tracking-wider">threshold ≥ {threshold}%</span>
          {scannerPaused && <span className="text-[10px] text-red font-bold uppercase">PAUSED: {gateState}</span>}
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors" aria-label="Close scanner">
          <X size={18} className="text-dim" />
        </button>
      </div>

      <div className={cn(
        "bg-accent/5 border-b border-border overflow-x-auto no-scrollbar shrink-0 transition-all duration-300 ease-in-out",
        activeWindows.length > 0 ? "h-[42px] p-2.5 opacity-100" : "h-0 p-0 opacity-0 border-none"
      )}>
        <div className="flex gap-4">
          {activeWindows.map((window) => (
            <div key={window.symbol} className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border rounded whitespace-nowrap h-[26px]">
              <strong className={cn("text-[11px] font-mono", window.direction === 'long' ? "text-green" : "text-red")}>
                {window.symbol}
              </strong>
              <span className="text-[10px] text-dim font-mono">{Math.round(window.remaining_ms / 1000)}s</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-2 text-[10px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[36px] shrink-0 md:grid hidden">
        <span>#</span>
        <span>Symbol</span>
        <span className="text-right">Move</span>
        <span className="text-center">Trend</span>
        <span className="text-right">Volume</span>
        <span className="text-right px-2">Score</span>
        <span className="text-center">Pass</span>
      </div>

      {/* Mobile Header (Simplified) */}
      <div className="grid grid-cols-[30px_100px_1fr_1fr] items-center px-4 py-2 text-[10px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[36px] shrink-0 md:hidden">
        <span>#</span>
        <span>Symbol</span>
        <span className="text-right">Move</span>
        <span className="text-center">Pass</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scannerResults.length === 0 ? (
          <div className="h-full flex items-center justify-center text-dim text-[13px] font-medium">Waiting for scanner data...</div>
        ) : (
          scannerResults.map((opp, i) => {
            const passing = Math.abs(opp.pct) >= threshold
            const dir = (opp.dir || opp.direction || '').toLowerCase()
            const isLong = dir ? dir === 'long' : opp.pct >= 0
            const isSingleMonitor = config?.single_symbol_configs?.some(sc => sc.symbol === opp.symbol && sc.enabled)

            return (
              <div key={opp.symbol}
                className={cn(
                  "grid grid-cols-[30px_100px_1fr_1fr] md:grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-3 border-b border-border/50 transition-opacity h-[56px]",
                  !passing && "opacity-45",
                  isSingleMonitor && "bg-accent/5"
                )}>
                <span className="text-[11px] text-dim font-mono">#{i + 1}</span>
                <div className="flex flex-col justify-center overflow-hidden">
                   <div className="flex items-baseline gap-0.5">
                     <span className="text-[13px] font-bold font-mono truncate">{opp.symbol.replace("USDT", "")}</span>
                     <span className="text-[9px] text-dim font-mono">/U</span>
                   </div>
                   {isSingleMonitor && (
                     <div className="flex items-center gap-1">
                        <ShieldCheck size={10} className="text-accent" />
                        <span className="text-[8px] font-bold text-accent uppercase tracking-tighter">Monitor</span>
                     </div>
                   )}
                </div>
                <span className={cn(
                  "text-[14px] font-bold font-mono text-right",
                  isLong ? "text-green" : "text-red"
                )}>
                  {isLong ? "▲" : "▼"}{Number(Math.abs(opp.pct || 0)).toFixed(1)}%
                </span>
                <div className="md:flex justify-center hidden">
                  <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={16} />
                </div>
                <span className="text-[11px] text-dim font-mono text-right md:block hidden">{fmtVol(opp.vol)}</span>
                <div className="md:flex items-center gap-2 px-2 overflow-hidden hidden">
                  <div className="flex-1 h-1 bg-border rounded-full overflow-hidden min-w-[20px]">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${(Number(opp.score || 0) / 10) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-dim font-mono whitespace-nowrap">{Number(opp.score || 0).toFixed(1)}</span>
                </div>
                {passing
                  ? <span className="text-[10px] font-bold text-green text-center">PASS</span>
                  : <span className="text-[10px] font-medium text-dim text-center">WAIT</span>}
              </div>
            )
          })
        )}
      </div>

      <div className="p-3 border-t border-border text-[10px] text-dim font-medium text-center shrink-0">
        WS: !miniTicker@arr + kline · Real-time updates
      </div>
    </div>
  )
})
