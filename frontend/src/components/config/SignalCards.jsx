import React, { useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { AlertTriangle, ChevronDown, Plus, Trash2, Info } from 'lucide-react';
import { cn, Tooltip } from '../ui/primitives';

export const ExitSignalCard = React.memo(({
  signal,
  active,
  layers,
  delays,
  actions,
  timeframes,
  scanTimeframe,
  isComboMode,
  isRequired,
  onToggleRequired,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onUpdateLayer,
  engulfingMode
}) => {
  const [key, label, desc] = signal;
  const [expanded, setExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className={cn("signal-stack-row flex flex-col gap-2 p-2.5 bg-transparent border-b rounded-none hover:border-border-hover transition-all", active ? "border-red/30 bg-red/[0.01]" : "border-border")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={cn("text-xs font-bold break-words leading-snug", active ? "text-red" : "text-text")}>{label}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowInfo(v => !v); }}
            aria-label={`Toggle description for ${label}`}
            className={cn(
              "p-1 rounded-md transition-colors shrink-0 cursor-pointer",
              showInfo ? "text-red bg-red/10" : "text-dim hover:text-text hover:bg-white/5"
            )}
            title="Toggle signal description & details"
          >
            <Info size={13} />
          </button>
        </div>
        <Switch.Root
          checked={active}
          onCheckedChange={() => onToggle(key, active)}
          className={cn("h-6 w-11 rounded-full transition-colors relative outline-none shrink-0 focus-visible:ring-2 focus-visible:ring-accent", active ? "bg-red" : "bg-border")}
          aria-label={`Toggle ${label} exit signal`}
        >
          <Switch.Thumb className={cn("block h-5 w-5 rounded-full bg-white transition-transform duration-100", active ? "translate-x-5" : "translate-x-0.5")} />
        </Switch.Root>
      </div>

      {showInfo && (
        <div className="p-2.5 bg-background/70 border border-border/60 rounded-xl text-[10px] text-dim font-medium leading-relaxed text-left animate-in fade-in duration-200">
          {desc}
        </div>
      )}

      {active && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)} className="flex items-center justify-between min-h-[32px] text-xs text-dim text-left"><span>{timeframes[key] === 'default' || !timeframes[key] ? `Scan default · ${scanTimeframe}` : `Effective · ${timeframes[key]}`} · {expanded ? 'Collapse settings' : 'Edit condition'}</span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button>}

      {active && expanded && isComboMode && (
        <div className="flex items-center justify-between p-2 bg-background/50 border border-border/30 rounded-xl mt-1">
          <span className="text-[9px] font-black uppercase text-dim tracking-wider">Condition Role</span>
          <button
            type="button"
            onClick={() => onToggleRequired(key)}
            className={cn(
              "px-2.5 py-1 rounded text-[8px] font-black uppercase tracking-wider transition-all focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none",
              isRequired
                ? "bg-red text-white shadow-sm"
                : "bg-surface text-dim border border-border/50 hover:text-text"
            )}
            aria-label={`Set ${label} exit role to ${isRequired ? 'Optional' : 'Required'}`}
          >
            {isRequired ? '⚡ REQUIRED (AND)' : '⚪ OPTIONAL (ANY)'}
          </button>
        </div>
      )}

      {active && expanded && (
        <div className="flex flex-col gap-3.5 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {key === 'engulfing' && (engulfingMode === 'soft_range' || engulfingMode === 'soft_body') && (
            <div className="text-[9.5px] font-semibold text-amber bg-amber/10 border border-amber/20 rounded-xl p-2.5 flex items-start gap-2 leading-snug text-left">
              <AlertTriangle className="shrink-0 text-amber mt-0.5 animate-pulse" size={13} />
              <span>
                <strong>Whipsaw Risk:</strong> Soft engulfing modes evaluate off live candles. Without an exit delay, tick-by-tick fluctuations can cause rapid enter/exit oscillation. Suggest adding a delay (e.g. 15-30s).
              </span>
            </div>
          )}
          {layers.map((layerKey, idx) => {
            const isBase = layerKey === key;
            const delayValue = delays[layerKey] || 0;
            const actionValue = actions[layerKey] || 'close';
            const tfValue = timeframes[layerKey] || 'default';
            const isCandleType = typeof delayValue === 'string' && /^\d+c$/.test(delayValue);
            const candleCountValue = isCandleType ? parseInt(delayValue.slice(0, -1), 10) : 1;

            return (
              <div key={layerKey} className="p-3 bg-background/50 border border-border/30 rounded-xl flex flex-col gap-2.5 relative group/layer">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-red">
                    Layer {idx + 1} {isBase ? "(Base)" : `(Chain: _${layerKey.split('_').pop()})`}
                  </span>
                  {!isBase && (
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(layerKey)}
                      aria-label={`Remove Layer ${idx + 1}`}
                      className="p-1 text-dim hover:text-red transition-colors opacity-0 group-hover/layer:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0 items-end">
                  {/* Timeframe Selection */}
                  <div className="flex flex-col gap-1 text-left min-w-0">
                    <label htmlFor={`tf-${layerKey}`} className="text-[9px] text-dim uppercase tracking-wider font-bold">Timeframe</label>
                    <select
                      id={`tf-${layerKey}`}
                      value={tfValue}
                      onChange={(e) => onUpdateLayer(layerKey, 'timeframe', e.target.value)}
                      className="bg-surface border border-border/80 rounded-lg px-2.5 py-1.5 text-xs font-bold text-text focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none cursor-pointer min-h-[32px] w-full"
                    >
                      <option value="default">Scan default ({scanTimeframe})</option>
                      <option value="1m">1m</option>
                      <option value="3m">3m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="30m">30m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                      <option value="1d">1d</option>
                    </select>
                  </div>

                  {/* Delay Input (Time or Candles) */}
                  <div className="flex flex-col gap-1 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-dim uppercase tracking-wider font-bold">Delay</span>
                      <div className="flex bg-surface border border-border/60 rounded-md p-0.5" role="group" aria-label="Delay mode selection">
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateLayer(layerKey, 'delay', 0);
                          }}
                          className={cn(
                            "px-1.5 py-0.5 text-[8px] font-black uppercase rounded transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                            !isCandleType
                              ? "bg-accent/15 text-accent font-bold"
                              : "text-dim hover:text-text"
                          )}
                          aria-pressed={!isCandleType}
                        >
                          Time
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateLayer(layerKey, 'delay', "1c");
                          }}
                          className={cn(
                            "px-1.5 py-0.5 text-[8px] font-black uppercase rounded transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                            isCandleType
                              ? "bg-accent/15 text-accent font-bold"
                              : "text-dim hover:text-text"
                          )}
                          aria-pressed={isCandleType}
                        >
                          Candle
                        </button>
                      </div>
                    </div>

                    {!isCandleType ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          placeholder="0h"
                          value={Math.floor((Number(delayValue) || 0) / 3600) || ''}
                          onChange={(e) => {
                            const h = parseInt(e.target.value) || 0;
                            const m = Math.floor(((Number(delayValue) || 0) % 3600) / 60);
                            onUpdateLayer(layerKey, 'delay', (h * 3600) + (m * 60));
                          }}
                          className="bg-surface/90 border border-border/80 rounded-lg px-2 py-1.5 min-h-[32px] text-xs font-mono font-bold focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none text-right w-full tabular-nums"
                        />
                        <span className="text-dim font-bold">:</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="59"
                          placeholder="0m"
                          value={Math.floor(((Number(delayValue) || 0) % 3600) / 60) || ''}
                          onChange={(e) => {
                            const h = Math.floor((Number(delayValue) || 0) / 3600);
                            const m = parseInt(e.target.value) || 0;
                            onUpdateLayer(layerKey, 'delay', (h * 3600) + (m * 60));
                          }}
                          className="bg-surface/90 border border-border/80 rounded-lg px-2 py-1.5 min-h-[32px] text-xs font-mono font-bold focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none text-right w-full tabular-nums"
                        />
                      </div>
                    ) : (
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="1000"
                          placeholder="1"
                          value={candleCountValue}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value) || 1);
                            onUpdateLayer(layerKey, 'delay', `${val}c`);
                          }}
                          className="bg-surface/90 border border-border/80 rounded-lg px-2.5 py-1.5 min-h-[32px] text-xs font-mono font-bold focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none text-right w-full pr-6 tabular-nums"
                          aria-label="Number of candles delay"
                        />
                        <span className="absolute right-2.5 text-[9px] font-bold text-dim/60 font-mono pointer-events-none">c</span>
                      </div>
                    )}
                  </div>

                  {/* Action Selection */}
                  <div className="flex flex-col gap-1 text-left">
                    <label htmlFor={`action-${layerKey}`} className="text-[9px] text-dim uppercase tracking-wider font-bold">Action</label>
                    <select
                      id={`action-${layerKey}`}
                      value={actionValue}
                      onChange={(e) => onUpdateLayer(layerKey, 'action', e.target.value)}
                      className={cn(
                        "border rounded-lg px-2.5 py-1.5 text-xs font-black uppercase tracking-tight outline-none cursor-pointer min-h-[32px] text-center w-full focus:ring-1",
                        actionValue === 'lock_sl'
                          ? "bg-purple/10 border-purple/30 text-purple focus:border-purple focus:ring-purple/30"
                          : "bg-red/10 border-red/30 text-red focus:border-red focus:ring-red/30"
                      )}
                    >
                      <option value="close">Close</option>
                      <option value="lock_sl">Lock SL</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onAddLayer(key)}
            className="w-full py-1.5 border border-dashed border-border rounded-xl text-[9px] font-black uppercase tracking-wider text-dim hover:text-red hover:border-red/40 hover:bg-red/5 transition-all flex items-center justify-center gap-1.5"
          >
            <Plus size={11} /> Add Chained Layer
          </button>
        </div>
      )}
    </div>
  );
})
ExitSignalCard.displayName = 'ExitSignalCard'

export const EntrySignalCard = React.memo(({
  signal,
  active,
  layers,
  timeframes,
  scanTimeframe,
  isComboMode,
  isRequired,
  onToggleRequired,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onUpdateLayer
}) => {
  const [key, label, desc] = signal;
  const [expanded, setExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className={cn("signal-stack-row flex flex-col gap-2 p-2.5 bg-transparent border-b rounded-none hover:border-border-hover transition-all", active ? "border-accent/30 bg-accent/[0.01]" : "border-border")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={cn("text-xs font-bold break-words leading-snug", active ? "text-accent" : "text-text")}>{label}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowInfo(v => !v); }}
            aria-label={`Toggle description for ${label}`}
            className={cn(
              "p-1 rounded-md transition-colors shrink-0 cursor-pointer",
              showInfo ? "text-accent bg-accent/10" : "text-dim hover:text-text hover:bg-white/5"
            )}
            title="Toggle signal description & details"
          >
            <Info size={13} />
          </button>
        </div>
        <Switch.Root
          checked={active}
          onCheckedChange={() => onToggle(key, active)}
          className={cn("h-6 w-11 rounded-full transition-colors relative outline-none shrink-0 focus-visible:ring-2 focus-visible:ring-accent", active ? "bg-accent" : "bg-border")}
          aria-label={`Toggle ${label} entry signal`}
        >
          <Switch.Thumb className={cn("block h-5 w-5 rounded-full bg-white transition-transform duration-100", active ? "translate-x-5" : "translate-x-0.5")} />
        </Switch.Root>
      </div>

      {showInfo && (
        <div className="p-2.5 bg-background/70 border border-border/60 rounded-xl text-[10px] text-dim font-medium leading-relaxed text-left animate-in fade-in duration-200">
          {desc}
        </div>
      )}

      {active && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)} className="flex items-center justify-between min-h-[32px] text-xs text-dim text-left"><span>{timeframes[key] === 'default' || !timeframes[key] ? `Scan default · ${scanTimeframe}` : `Effective · ${timeframes[key]}`} · {expanded ? 'Collapse settings' : 'Edit condition'}</span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button>}

      {active && expanded && isComboMode && (
        <div className="flex items-center justify-between p-2 bg-background/50 border border-border/30 rounded-xl mt-1">
          <span className="text-[9px] font-black uppercase text-dim tracking-wider">Condition Role</span>
          <button
            type="button"
            onClick={() => onToggleRequired(key)}
            className={cn(
              "px-2.5 py-1 rounded text-[8px] font-black uppercase tracking-wider transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
              isRequired
                ? "bg-accent text-white shadow-sm"
                : "bg-surface text-dim border border-border/50 hover:text-text"
            )}
            aria-label={`Set ${label} role to ${isRequired ? 'Optional' : 'Required'}`}
          >
            {isRequired ? '⚡ REQUIRED (AND)' : '⚪ OPTIONAL (ANY)'}
          </button>
        </div>
      )}

      {active && expanded && (
        <div className="flex flex-col gap-3 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {layers.map((layerKey, idx) => {
            const isBase = layerKey === key;
            const tfValue = timeframes[layerKey] || 'default';

            return (
              <div key={layerKey} className="p-2.5 bg-background/50 border border-border/30 rounded-xl flex items-center justify-between gap-3 relative group/layer">
                <div className="flex flex-col text-left">
                  <span className="text-[9px] font-black uppercase tracking-wider text-accent">
                    Layer {idx + 1} {isBase ? "(Base)" : `(Chain: _${layerKey.split('_').pop()})`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-left">
                    <label htmlFor={`tf-${layerKey}`} className="text-[8px] text-dim uppercase tracking-wider font-bold">Timeframe</label>
                    <select
                      id={`tf-${layerKey}`}
                      value={tfValue}
                      onChange={(e) => onUpdateLayer(layerKey, 'timeframe', e.target.value)}
                      className="bg-surface border border-border/80 rounded-lg px-2.5 py-1.5 text-xs font-bold text-text focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none cursor-pointer min-h-[32px] w-full"
                    >
                      <option value="default">Scan default ({scanTimeframe})</option>
                      <option value="1m">1m</option>
                      <option value="3m">3m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="30m">30m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                      <option value="1d">1d</option>
                    </select>
                  </div>

                  {!isBase && (
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(layerKey)}
                      aria-label={`Remove Layer ${idx + 1}`}
                      className="p-1 text-dim hover:text-red transition-colors opacity-0 group-hover/layer:opacity-100 focus-visible:opacity-100 animate-in fade-in duration-200"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onAddLayer(key)}
            className="w-full py-1 border border-dashed border-border rounded-xl text-[9px] font-black uppercase tracking-wider text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all flex items-center justify-center gap-1.5"
          >
            <Plus size={11} /> Add Chained Layer
          </button>
        </div>
      )}
    </div>
  );
})
EntrySignalCard.displayName = 'EntrySignalCard'
