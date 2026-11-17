import React, { useMemo } from 'react';
import {
  SlidersHorizontal,
  Search,
  Zap,
  ShieldCheck,
  Target,
  XCircle,
  Clock,
  ArrowRight,
  Trash2,
  Layers,
  Briefcase,
} from 'lucide-react';
import { cn } from '../ui/primitives';

const TIMEFRAME_OPTIONS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

const formatUSD = (v) =>
  `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatSlTypeLabel = (slType) => {
  switch (slType) {
    case 'lookback_low/high':
      return 'High/Low Lookback';
    case 'streak_extreme':
      return 'Streak Extreme';
    case 'supertrend':
      return 'Supertrend Line';
    case 'pct':
    default:
      return 'Fixed %';
  }
};

const formatTpModeLabel = (tpMode) => {
  switch (tpMode) {
    case 'exp_rr_seq':
      return 'RR Milestone Ladder';
    case 'exp_rr_seq_switch':
      return 'Adaptive RR Ladder';
    case 'fixed':
    default:
      return 'Fixed Ratio';
  }
};

const formatDelayShort = (delayVal) => {
  if (!delayVal) return '0s';
  if (typeof delayVal === 'string' && /^\d+c$/.test(delayVal)) return delayVal;
  const secs = Number(delayVal) || 0;
  if (secs <= 0) return '0s';
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
};

const SectionJumpButton = React.memo(({ label = 'Full section', onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-dim hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
  >
    <span>{label}</span>
    <ArrowRight size={11} aria-hidden="true" />
  </button>
));
SectionJumpButton.displayName = 'SectionJumpButton';

export const ActiveSummaryPanel = React.memo(({
  cfg,
  setField,
  renderField,
  errors,
  riskAmount,
  activeVariants,
  isEdit,
  editingVariantIdx,
  SIGNALS,
  TOOLTIPS,
  getBaseSignalType,
  getSignalParamsSchema,
  onToggleEntrySignal,
  onRemoveEntryLayer,
  onUpdateEntryLayer,
  onToggleRequiredEntry,
  onToggleExitSignal,
  onRemoveExitLayer,
  onUpdateExitLayer,
  onToggleRequiredExit,
  onOpenFullSection,
  ConfigFieldComponent: ConfigField,
  ToggleComponent: Toggle,
  onInputFocus,
}) => {
  const entrySignals = Array.isArray(cfg.enabled_signals) ? cfg.enabled_signals : [];
  const exitSignals = Array.isArray(cfg.exit_signals) ? cfg.exit_signals : [];
  const requiredEntrySignals = Array.isArray(cfg.required_signals) ? cfg.required_signals : [];
  const requiredExitSignals = Array.isArray(cfg.required_exit_signals) ? cfg.required_exit_signals : [];
  const signalTimeframes = cfg.signal_timeframes || {};
  const exitDelays = cfg.exit_signal_delays || {};
  const exitActions = cfg.exit_signal_actions || {};

  const entryLogic = cfg.signal_logic || 'all';
  const exitLogic = cfg.exit_signal_logic || 'any';
  const activeMode = cfg.trading_mode || (cfg.paper_mode ? 'paper' : 'live');
  const scannerEnabled = cfg.global_scanner_enabled !== false;
  const slType = cfg.sl_type || 'pct';
  const tpMode = cfg.tp_mode || 'fixed';
  const staticSymbols = Array.isArray(cfg.symbols) ? cfg.symbols : [];
  const excludedSymbols = Array.isArray(cfg.excluded_symbols) ? cfg.excluded_symbols : [];
  const manualMonitors = Array.isArray(cfg.single_symbol_configs) ? cfg.single_symbol_configs : [];
  const tradingWindows = Array.isArray(cfg.trading_windows) ? cfg.trading_windows : [];

  const modeDisplay = useMemo(() => {
    if (activeMode === 'live') return 'Live';
    if (activeMode === 'testnet') return 'Testnet';
    if (activeMode === 'backtest') return 'Backtest';
    return 'Paper';
  }, [activeMode]);

  const rrPairs = useMemo(() => {
    const liveSeq = Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0];
    const exitSeq = Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0];
    return liveSeq.map((t, idx) => `${t}R→${exitSeq[idx] ?? 0}R`);
  }, [cfg.live_rr_sequence, cfg.exit_rr_sequence]);

  const hasKnifeSignal = useMemo(
    () => entrySignals.some((s) => getBaseSignalType(s) === 'knife_catch'),
    [entrySignals, getBaseSignalType],
  );

  const combinedVariantRisk = useMemo(
    () => activeVariants.reduce((sum, v) => sum + (Number(v?.risk_pct_per_trade) || 0), 0),
    [activeVariants],
  );

  const signalTitleFor = React.useCallback((sigKey) => {
    const baseType = getBaseSignalType(sigKey);
    const meta = SIGNALS.find((s) => s[0] === baseType);
    const baseName = meta ? meta[1] : baseType;
    const isLayer = sigKey !== baseType;
    const suffix = isLayer ? ` _${sigKey.split('_').pop()}` : '';
    return { baseType, baseName, isLayer, title: `${baseName}${suffix}` };
  }, [SIGNALS, getBaseSignalType]);

  // Prune dormant parameters inside an active signal (e.g. hide MACD periods on ema_dual when MACD filter is off)
  const filterActiveSignalParams = React.useCallback((sigKey, baseType, schema) => {
    if (['ema_dual', 'ema_dual_cross', 'ema_dual_close'].includes(baseType)) {
      const suffix = sigKey === baseType ? '' : sigKey.substring(baseType.length);
      const macdFilterKey = `signal_params_ema_dual_macd_filter${suffix}`;
      const macdFilterEnabled = cfg[macdFilterKey] === true || cfg[macdFilterKey] === 'true';
      if (!macdFilterEnabled) {
        return schema.filter((f) => !['macd_fast', 'macd_slow', 'macd_signal'].includes(f.baseParamKey));
      }
    }
    return schema;
  }, [cfg]);

  const renderSchemaFields = React.useCallback((sigKey, schema, isLayered, accentColor = 'bg-accent') => {
    if (!schema || schema.length === 0) return null;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2.5">
        {schema.map((field) => {
          const helpText = TOOLTIPS[field.baseParamKey];
          if (field.type === 'boolean') {
            const checked = cfg[field.key] !== undefined ? cfg[field.key] === true : field.defaultValue;
            return (
              <div
                key={field.key}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]"
              >
                <span className="text-[11px] font-semibold text-text/90 truncate" title={helpText || field.label}>
                  {field.label}
                </span>
                <Toggle
                  value={checked}
                  onChange={(v) => setField(field.key, v)}
                  color={isLayered ? 'bg-purple' : accentColor}
                />
              </div>
            );
          }

          return (
            <ConfigField
              key={field.key}
              id={`summary-${sigKey}-${field.key}`}
              name={field.key}
              label={field.label}
              type={field.type}
              value={cfg[field.key] !== undefined ? cfg[field.key] : field.defaultValue}
              onChange={setField}
              error={errors[field.key]}
              warning={errors[`${field.key}_warn`]}
              opts={field.opts}
              helpText={helpText}
              attrs={{ ...field.attrs, onFocus: onInputFocus }}
            />
          );
        })}
      </div>
    );
  }, [ConfigField, TOOLTIPS, Toggle, cfg, errors, onInputFocus, setField]);

  const dormantModules = useMemo(() => {
    const items = [];
    if (!cfg.trailing_stop_enabled) items.push({ label: 'Dynamic Trailing', tab: 'risk', section: 'risk_tp' });
    if (!cfg.martingale_enabled) items.push({ label: 'Martingale', tab: 'risk', section: 'risk_martingale' });
    if (!cfg.smart_watchlist_enabled && scannerEnabled) items.push({ label: 'Smart Watchlist', tab: 'scan', section: 'scan_global' });
    if (!cfg.frequency_shaping_enabled) items.push({ label: 'Frequency Shaping', tab: 'risk', section: 'risk_temporal' });
    if (!cfg.risk_use_tod_stats) items.push({ label: 'Time-of-Day Guard', tab: 'risk', section: 'risk_temporal' });
    if (!cfg.auto_adjust_max_trades_enabled) items.push({ label: 'Zero-Risk Trade Step', tab: 'risk', section: 'risk_guards' });
    if (!cfg.release_risk_on_est_pnl_be) items.push({ label: 'Est. P&L Risk Release', tab: 'risk', section: 'risk_guards' });
    return items;
  }, [
    cfg.auto_adjust_max_trades_enabled,
    cfg.frequency_shaping_enabled,
    cfg.martingale_enabled,
    cfg.release_risk_on_est_pnl_be,
    cfg.risk_use_tod_stats,
    cfg.smart_watchlist_enabled,
    cfg.trailing_stop_enabled,
    scannerEnabled,
  ]);

  const countErrorsForKeys = React.useCallback((keys) => {
    if (!errors) return 0;
    let count = 0;
    for (const k of keys) {
      if (errors[k]) count += 1;
    }
    return count;
  }, [errors]);

  const envErrCount = countErrorsForKeys(['trading_mode']);
  const scanErrCount = countErrorsForKeys([
    'scan_interval',
    'discovery_mode',
    'scan_lookback',
    'scan_mode',
    'scanner_weights_momentum',
    'scanner_weights_volatility',
    'scanner_weights_trend',
    'scanner_signal_depth',
  ]);
  const riskErrCount = countErrorsForKeys([
    'slippage_warning_threshold',
    'risk_pct_per_trade',
    'max_open_trades',
    'sl_distance_pct',
    'martingale_multiplier',
    'martingale_reset_threshold_pct',
    'martingale_max_steps',
    'martingale_post_reset_behavior',
  ]);

  return (
    <div
      id="config-panel-summary"
      role="tabpanel"
      aria-labelledby="config-tab-summary"
      className="flex flex-col gap-3 animate-in fade-in duration-200"
    >
      {/* 1. Executive Strategy Snapshot + Identity */}
      <section
        id="summary_env"
        aria-invalid={envErrCount > 0}
        className={cn(
          'rounded-xl border p-3 sm:p-4 flex flex-col gap-3 transition-colors',
          envErrCount > 0 ? 'border-red/60 bg-red/[0.03]' : 'border-border/70 bg-background/50',
        )}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn(
              'w-6 h-6 rounded-md flex items-center justify-center shrink-0',
              envErrCount > 0 ? 'bg-red/15 text-red' : 'bg-accent/10 text-accent',
            )}>
              <SlidersHorizontal size={14} />
            </div>
            <h3 className={cn(
              'text-xs font-bold uppercase tracking-tight truncate',
              envErrCount > 0 && 'text-red',
            )}>
              Active Configuration
            </h3>
            {envErrCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red tabular-nums shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" aria-hidden="true" />
                {envErrCount} {envErrCount === 1 ? 'error' : 'errors'}
              </span>
            ) : (
              <>
                <span className="text-[11px] text-dim hidden sm:inline">·</span>
                <span className="text-[11px] text-dim truncate hidden sm:inline">
                  Only active rules &amp; parameters
                </span>
              </>
            )}
          </div>
          <SectionJumpButton label="Env" onClick={() => onOpenFullSection('env', 'adv_env')} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            {renderField('Strategy Label', 'strategy_label', 'text', null, { placeholder: 'Momentum Strategy' })}
          </div>
          <div className="sm:col-span-7 grid grid-cols-3 gap-2">
            <div className={cn(
              'px-2.5 py-2 rounded-lg border flex flex-col justify-between min-h-[52px]',
              errors?.trading_mode ? 'border-red/60 bg-red/10' : 'border-border/50 bg-surface/40',
            )}>
              <span className="text-[10px] font-semibold text-dim">Mode</span>
              <div className="flex items-center justify-between gap-1">
                <span className={cn('text-xs font-bold truncate', errors?.trading_mode ? 'text-red' : 'text-text')}>
                  {modeDisplay}
                </span>
                {(!isEdit || errors?.trading_mode) && (
                  <button
                    type="button"
                    onClick={() => onOpenFullSection('env', 'adv_env')}
                    className={cn(
                      'text-[10px] font-semibold hover:underline cursor-pointer shrink-0',
                      errors?.trading_mode ? 'text-red' : 'text-accent',
                    )}
                  >
                    {errors?.trading_mode ? 'Fix' : 'Switch'}
                  </button>
                )}
              </div>
              {errors?.trading_mode && (
                <span className="text-[10px] font-semibold text-red truncate" title={errors.trading_mode}>
                  {errors.trading_mode}
                </span>
              )}
            </div>
            <div className="px-2.5 py-2 rounded-lg border border-border/50 bg-surface/40 flex flex-col justify-between min-h-[52px]">
              <span className="text-[10px] font-semibold text-dim">Risk / Cap</span>
              <span className="text-xs font-mono font-bold tabular-nums text-text truncate">
                {formatUSD(riskAmount)} <span className="text-dim font-normal">·</span> {Number(cfg.risk_pct_per_trade ?? 1)}%
              </span>
            </div>
            <div className="px-2.5 py-2 rounded-lg border border-border/50 bg-surface/40 flex flex-col justify-between min-h-[52px]">
              <span className="text-[10px] font-semibold text-dim">Gates</span>
              <span className="text-xs font-mono font-bold tabular-nums text-text truncate">
                {entrySignals.length} In <span className="text-dim font-normal">·</span> {exitSignals.length} Out
              </span>
            </div>
          </div>
        </div>

        {activeVariants.length > 0 && editingVariantIdx === null && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs">
            <div className="flex items-center gap-2 text-dim min-w-0">
              <Layers size={13} className="text-violet-400 shrink-0" />
              <span className="truncate">
                Staged variants: <strong className="text-text font-mono tabular-nums">{activeVariants.length}</strong>
                {' · '}Combined risk <strong className="text-text font-mono tabular-nums">{combinedVariantRisk.toFixed(1)}%</strong>
              </span>
            </div>
            <SectionJumpButton label="Presets" onClick={() => onOpenFullSection('presets')} />
          </div>
        )}
      </section>

      {/* 2. Scanner & Market Scope */}
      <section
        id="summary_scan"
        aria-invalid={scanErrCount > 0}
        className={cn(
          'rounded-xl border p-3 sm:p-4 flex flex-col gap-3 transition-colors',
          scanErrCount > 0 ? 'border-red/60 bg-red/[0.03]' : 'border-border/70 bg-background/50',
        )}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn(
              'w-6 h-6 rounded-md flex items-center justify-center shrink-0',
              scanErrCount > 0 ? 'bg-red/15 text-red' : 'bg-accent/10 text-accent',
            )}>
              <Search size={14} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h3 className={cn(
                'text-xs font-bold uppercase tracking-tight truncate',
                scanErrCount > 0 && 'text-red',
              )}>
                Scanner &amp; Scope
              </h3>
              {scanErrCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red tabular-nums shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" aria-hidden="true" />
                  {scanErrCount} {scanErrCount === 1 ? 'error' : 'errors'}
                </span>
              ) : (
                <span className="text-[11px] font-mono tabular-nums text-dim truncate hidden sm:inline">
                  {scannerEnabled
                    ? `Top ${cfg.watchlist_size ?? 15} · ${cfg.scan_interval || '1m'} · ${(cfg.entry_side || 'both').toUpperCase()}`
                    : `Static only · ${staticSymbols.length} symbol(s)`}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Toggle
              value={scannerEnabled}
              onChange={(v) => setField('global_scanner_enabled', v)}
              label=""
            />
            <SectionJumpButton
              label="Full"
              onClick={() => onOpenFullSection('scan', scannerEnabled ? 'scan_global' : 'scan_watchlist')}
            />
          </div>
        </div>

        {scannerEnabled ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {renderField('Timeframe', 'scan_interval', 'text', TIMEFRAME_OPTIONS)}
              {renderField('Entry Side', 'entry_side', 'text', [
                { value: 'both', label: 'Both (Long & Short)' },
                { value: 'long', label: 'Long Only' },
                { value: 'short', label: 'Short Only' },
              ])}
              {renderField('% Threshold', 'scan_pct_threshold', 'number', null, { min: 0.1, step: 0.1 })}
              {renderField('Watchlist Size', 'watchlist_size', 'number', null, { min: 1, max: 100 })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {renderField('Discovery Mode', 'discovery_mode', 'text', [
                { value: 'volume', label: 'Top 24h Volume' },
                { value: 'change_pct', label: 'Top 24h Gainers' },
                { value: 'loss_pct', label: 'Top 24h Losers' },
                { value: 'abs_change_pct', label: 'Top Abs Movers' },
              ])}
              {renderField('Min Vol ($)', 'scan_min_volume_usdt', 'number', null, { min: 0, step: 100000 })}
              {renderField('Mom. Lookback', 'scan_lookback', 'number', null, { min: 1, max: 100 })}
              {renderField('Signal Depth', 'scanner_signal_depth', 'number', null, { min: 1, max: 50 })}
            </div>

            {cfg.scan_mode === 'active_window' && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
                {renderField('Window Duration (s)', 'scan_window_duration_sec', 'number', null, { min: 1 })}
                {renderField('Check Interval (s)', 'scan_check_interval_sec', 'number', null, { min: 1 })}
              </div>
            )}

            {cfg.smart_watchlist_enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/40 items-end">
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
                  <span className="text-[11px] font-semibold text-text">Smart Watchlist</span>
                  <Toggle value={true} onChange={(v) => setField('smart_watchlist_enabled', v)} />
                </div>
                {renderField('Discovery Sensitivity', 'smart_watchlist_sensitivity', 'number', null, { min: 0.1, max: 1.0, step: 0.1 })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40 text-[11px] text-dim font-mono tabular-nums">
              <span>
                Weights {cfg.scanner_weights_momentum ?? 50}/{cfg.scanner_weights_volatility ?? 30}/{cfg.scanner_weights_trend ?? 20}%
                {cfg.htf_ema_cross_boost_enabled !== false && ` · HTF Boost ${cfg.htf_ema_cross_interval || '4h'}`}
                {staticSymbols.length > 0 && ` · +${staticSymbols.length} static`}
                {excludedSymbols.length > 0 && ` · ${excludedSymbols.length} excluded`}
                {manualMonitors.length > 0 && ` · ${manualMonitors.length} monitors`}
              </span>
              <button
                type="button"
                onClick={() => onOpenFullSection('scan', 'scan_watchlist')}
                className="font-sans font-semibold text-accent hover:underline cursor-pointer"
              >
                Watchlist &amp; Exclusions →
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="text-xs text-dim">
              Global market scanning is off. Evaluating static symbols:{' '}
              <span className="font-mono text-text font-semibold">
                {staticSymbols.length > 0 ? staticSymbols.slice(0, 6).join(', ') + (staticSymbols.length > 6 ? ` +${staticSymbols.length - 6}` : '') : 'None configured'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:w-64 shrink-0">
              {renderField('Base TF', 'scan_interval', 'text', TIMEFRAME_OPTIONS)}
              {renderField('Side', 'entry_side', 'text', [
                { value: 'both', label: 'Both' },
                { value: 'long', label: 'Long' },
                { value: 'short', label: 'Short' },
              ])}
            </div>
          </div>
        )}
        {errors?.scanner_weights_momentum && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-red/30 text-[11px] text-red font-semibold">
            <span>Scoring Weights: {errors.scanner_weights_momentum}</span>
            <button
              type="button"
              onClick={() => onOpenFullSection('scan', 'scan_global')}
              className="text-red underline cursor-pointer shrink-0"
            >
              Fix Weights →
            </button>
          </div>
        )}
        {errors?.scan_mode && cfg.scan_mode !== 'active_window' && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-red/30 text-[11px] text-red font-semibold">
            <span>Scan Mode: {errors.scan_mode}</span>
            <button
              type="button"
              onClick={() => onOpenFullSection('scan', 'scan_global')}
              className="text-red underline cursor-pointer shrink-0"
            >
              Fix Scan Mode →
            </button>
          </div>
        )}
      </section>

      {/* 3. Entry Signals & Active Signal Parameters */}
      <section className="rounded-xl border border-border/70 bg-background/50 p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center text-accent shrink-0">
              <Zap size={14} />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-tight truncate">Entry Signals</h3>
            <span className="text-[11px] font-mono tabular-nums text-dim">
              {entrySignals.length} active · {entryLogic.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex bg-surface p-0.5 rounded-lg border border-border/70">
              {['any', 'all', 'combo'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setField('signal_logic', m)}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap',
                    entryLogic === m ? 'bg-accent text-white' : 'text-dim hover:text-text',
                  )}
                >
                  {m === 'all' ? 'ALL' : m.toUpperCase()}
                </button>
              ))}
            </div>
            <SectionJumpButton label="Signals" onClick={() => onOpenFullSection('strategy', 'strategy_entry')} />
          </div>
        </div>

        {entrySignals.length === 0 ? (
          <div className="flex items-center justify-between gap-3 py-2 text-xs text-dim">
            <span>No active entry signals — scanner momentum alone triggers entry.</span>
            <button
              type="button"
              onClick={() => onOpenFullSection('strategy', 'strategy_entry')}
              className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent font-semibold hover:bg-accent/20 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Add Entry Signal →
            </button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/40">
            {entrySignals.map((sigKey) => {
              const { baseType, isLayer, title } = signalTitleFor(sigKey);
              const isAlsoExit = exitSignals.includes(sigKey);
              const rawSchema = getSignalParamsSchema(sigKey, baseType, true, isAlsoExit);
              const activeSchema = filterActiveSignalParams(sigKey, baseType, rawSchema);
              const tfValue = signalTimeframes[sigKey] || 'default';
              const isReq = requiredEntrySignals.includes(sigKey);

              return (
                <div key={sigKey} className="py-3 first:pt-0 last:pb-0 flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-text truncate">{title}</span>
                      {entryLogic === 'combo' && (
                        <button
                          type="button"
                          onClick={() => onToggleRequiredEntry(sigKey)}
                          className={cn(
                            'px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer whitespace-nowrap',
                            isReq
                              ? 'bg-accent text-white'
                              : 'bg-surface border border-border/70 text-dim hover:text-text',
                          )}
                        >
                          {isReq ? 'Required' : 'Optional'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        aria-label={`Timeframe for ${title}`}
                        value={tfValue}
                        onChange={(e) => onUpdateEntryLayer(sigKey, 'timeframe', e.target.value)}
                        className="bg-surface/90 border border-border/70 rounded-lg px-2 py-0.5 min-h-[28px] text-xs font-mono font-bold text-text focus:border-accent outline-none cursor-pointer"
                      >
                        <option value="default">Default ({cfg.scan_interval || '1m'})</option>
                        {TIMEFRAME_OPTIONS.map((tf) => (
                          <option key={tf} value={tf}>{tf}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => (isLayer ? onRemoveEntryLayer(sigKey) : onToggleEntrySignal(baseType, true))}
                        aria-label={`Remove ${title} entry signal`}
                        className="p-1.5 rounded-lg text-dim hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
                        title={`Remove ${title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {renderSchemaFields(sigKey, activeSchema, isLayer, 'bg-accent')}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Exit Strategy, Trailing & Active Exit Signals */}
      <section className="rounded-xl border border-border/70 bg-background/50 p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center text-accent shrink-0">
              <Target size={14} />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-tight truncate">Exit &amp; Profit Protection</h3>
            <span className="text-[11px] font-mono tabular-nums text-dim truncate hidden sm:inline">
              {formatTpModeLabel(tpMode)} · {cfg.trailing_stop_enabled ? 'Trailing On' : 'No Trailing'}
            </span>
          </div>
          <SectionJumpButton label="TP & Trailing" onClick={() => onOpenFullSection('risk', 'risk_tp')} />
        </div>

        {/* Profit Target Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          {renderField('Exit Strategy', 'tp_mode', 'text', [
            { value: 'fixed', label: 'Fixed Ratio (TP)' },
            { value: 'exp_rr_seq', label: 'Dynamic RR Milestone' },
            { value: 'exp_rr_seq_switch', label: 'Dynamic RR Milestone (Switch)' },
          ])}

          {tpMode === 'fixed' ? (
            renderField('Fixed Ratio (R)', 'tp_ratio', 'number', null, { min: 0.1, step: 0.1 })
          ) : (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-semibold text-dim">SL Ratchet Ladder</span>
                <span className="text-xs font-mono font-bold tabular-nums text-text truncate">
                  {rrPairs.join(' · ')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenFullSection('risk', 'risk_tp')}
                className="text-[11px] font-semibold text-accent hover:underline cursor-pointer shrink-0"
              >
                Edit Ladder →
              </button>
            </div>
          )}
        </div>

        {tpMode === 'exp_rr_seq_switch' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
            {renderField('Switch Peak RR', 'peak_rr_switch_threshold', 'number', null, { min: 0.1, step: 0.1 })}
            {renderField('Switch Hits', 'peak_rr_switch_count', 'number', null, { min: 1, step: 1 })}
            {renderField('Switched SL %', 'switched_sl_distance_pct', 'number', null, { min: 0.1, max: 10, step: 0.1 })}
          </div>
        )}

        {/* Dynamic Trailing Stop (compact toggle, expands inputs only when enabled) */}
        <div className="pt-2 border-t border-border/40 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-text">Dynamic Trailing Stop</span>
              {cfg.trailing_stop_enabled && (
                <span className="text-[11px] font-mono tabular-nums text-dim truncate">
                  {cfg.trailing_execution_mode || 'local'} · {cfg.trailing_activation_rr ?? 1}R act.
                </span>
              )}
            </div>
            <Toggle value={cfg.trailing_stop_enabled === true} onChange={(v) => setField('trailing_stop_enabled', v)} />
          </div>

          {cfg.trailing_stop_enabled && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {renderField('Exec Mode', 'trailing_execution_mode', 'text', [
                { value: 'local', label: 'Local' },
                { value: 'exchange', label: 'Exchange' },
                { value: 'native', label: 'Native' },
              ])}
              {renderField('Method', 'trailing_stop_type', 'text', [
                { value: 'pct', label: 'Percentage (%)' },
                { value: 'rr', label: 'Risk Multiple (R)' },
              ])}
              {renderField('Activation R:R', 'trailing_activation_rr', 'number', null, { min: 0, max: 10, step: 0.1 })}
              {cfg.trailing_stop_type === 'rr'
                ? renderField('Distance (R)', 'trailing_stop_rr', 'number', null, { min: 0.1, max: 10, step: 0.1 })
                : renderField('Distance (%)', 'trailing_stop_distance_pct', 'number', null, { min: 0.1, max: 10, step: 0.1 })}
            </div>
          )}
        </div>

        {/* Active Exit Signals */}
        <div className="pt-2 border-t border-border/40 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <XCircle size={13} className="text-red shrink-0" />
              <span className="text-xs font-bold text-text">Indicator Exit Signals</span>
              <span className="text-[11px] font-mono tabular-nums text-dim">
                {exitSignals.length} active{exitSignals.length > 0 ? ` · ${exitLogic.toUpperCase()}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {exitSignals.length > 0 && (
                <div className="flex bg-surface p-0.5 rounded-lg border border-border/70">
                  {['any', 'all', 'combo'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setField('exit_signal_logic', m)}
                      className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer',
                        exitLogic === m ? 'bg-red text-white' : 'text-dim hover:text-text',
                      )}
                    >
                      {m === 'all' ? 'ALL' : m.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
              <SectionJumpButton label="Exit Signals" onClick={() => onOpenFullSection('strategy', 'strategy_exit')} />
            </div>
          </div>

          {exitSignals.length === 0 ? (
            <div className="text-xs text-dim">No active indicator exit signals — exits rely on SL, TP, and milestone ladder.</div>
          ) : (
            <div className="flex flex-col divide-y divide-border/40">
              {cfg.exit_signals_override_ratchet && (
                <div className="pb-2 flex items-center justify-between text-xs">
                  <span className="text-dim">Exit signals override ratchet/trailing when in profit</span>
                  <Toggle
                    value={true}
                    onChange={(v) => setField('exit_signals_override_ratchet', v)}
                    color="bg-red"
                  />
                </div>
              )}

              {exitSignals.map((sigKey) => {
                const { baseType, isLayer, title } = signalTitleFor(sigKey);
                const isAlsoEntry = entrySignals.includes(sigKey);
                // If the same signal key is already displayed under Entry Signals, only show exit-specific params here
                const rawSchema = getSignalParamsSchema(sigKey, baseType, false, true);
                const exitSchema = isAlsoEntry
                  ? rawSchema.filter((f) => f.baseParamKey.startsWith('exit_') || f.baseParamKey.startsWith('trigger_candle_exit_'))
                  : filterActiveSignalParams(sigKey, baseType, rawSchema);
                const tfValue = signalTimeframes[sigKey] || 'default';
                const actionVal = exitActions[sigKey] || 'close';
                const delayStr = formatDelayShort(exitDelays[sigKey]);
                const isReq = requiredExitSignals.includes(sigKey);

                return (
                  <div key={sigKey} className="py-2.5 first:pt-1 last:pb-0 flex flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-red truncate">{title}</span>
                        <span className="text-[11px] font-mono text-dim">Delay {delayStr}</span>
                        {exitLogic === 'combo' && (
                          <button
                            type="button"
                            onClick={() => onToggleRequiredExit(sigKey)}
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer',
                              isReq
                                ? 'bg-red text-white'
                                : 'bg-surface border border-border/70 text-dim hover:text-text',
                            )}
                          >
                            {isReq ? 'Required' : 'Optional'}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          aria-label={`Exit timeframe for ${title}`}
                          value={tfValue}
                          onChange={(e) => onUpdateExitLayer(sigKey, 'timeframe', e.target.value)}
                          className="bg-surface/90 border border-border/70 rounded-lg px-2 py-0.5 min-h-[28px] text-xs font-mono font-bold text-text focus:border-accent outline-none cursor-pointer"
                        >
                          <option value="default">Default ({cfg.scan_interval || '1m'})</option>
                          {TIMEFRAME_OPTIONS.map((tf) => (
                            <option key={tf} value={tf}>{tf}</option>
                          ))}
                        </select>
                        <select
                          aria-label={`Exit action for ${title}`}
                          value={actionVal}
                          onChange={(e) => onUpdateExitLayer(sigKey, 'action', e.target.value)}
                          className="bg-surface/90 border border-border/70 rounded-lg px-2 py-0.5 min-h-[28px] text-xs font-bold text-text focus:border-accent outline-none cursor-pointer"
                        >
                          <option value="close">Close</option>
                          <option value="lock_sl">Lock SL</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => (isLayer ? onRemoveExitLayer(sigKey) : onToggleExitSignal(baseType, true))}
                          aria-label={`Remove ${title} exit signal`}
                          className="p-1.5 rounded-lg text-dim hover:text-red hover:bg-red/10 transition-colors cursor-pointer"
                          title={`Remove ${title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {renderSchemaFields(`exit-${sigKey}`, exitSchema, isLayer, 'bg-red')}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 5. Stop Loss & Capital Guards */}
      <section
        id="summary_risk"
        aria-invalid={riskErrCount > 0}
        className={cn(
          'rounded-xl border p-3 sm:p-4 flex flex-col gap-3 transition-colors',
          riskErrCount > 0 ? 'border-red/60 bg-red/[0.03]' : 'border-border/70 bg-background/50',
        )}
      >
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn(
              'w-6 h-6 rounded-md flex items-center justify-center shrink-0',
              riskErrCount > 0 ? 'bg-red/15 text-red' : 'bg-accent/10 text-accent',
            )}>
              <ShieldCheck size={14} />
            </div>
            <h3 className={cn(
              'text-xs font-bold uppercase tracking-tight truncate',
              riskErrCount > 0 && 'text-red',
            )}>
              Stop Loss &amp; Risk Guards
            </h3>
            {riskErrCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red tabular-nums shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" aria-hidden="true" />
                {riskErrCount} {riskErrCount === 1 ? 'error' : 'errors'}
              </span>
            ) : (
              <span className="text-[11px] font-mono tabular-nums text-dim truncate hidden sm:inline">
                {formatSlTypeLabel(slType)} · {Number(cfg.sl_min_pct ?? 0.3)}%–{Number(cfg.sl_max_pct ?? 3)}%
              </span>
            )}
          </div>
          <SectionJumpButton label="Risk Full" onClick={() => onOpenFullSection('risk', 'risk_sl')} />
        </div>

        {/* SL Strategy Row (strictly conditional on sl_type) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {renderField('SL Type', 'sl_type', 'text', [
            { value: 'pct', label: 'Fixed %' },
            { value: 'lookback_low/high', label: 'High/Low Stop' },
            { value: 'streak_extreme', label: 'Streak Extreme' },
            { value: 'supertrend', label: 'Supertrend' },
          ])}
          {renderField('Out of Bounds', 'sl_out_of_bounds_action', 'text', [
            { value: 'clamp', label: 'Clamp Limits' },
            { value: 'reject', label: 'Reject Entry' },
          ])}
          {slType === 'pct' ? (
            renderField('Distance %', 'sl_distance_pct', 'number', null, { min: 0.1, max: 50, step: 0.1 })
          ) : (
            <>
              {(slType === 'lookback_low/high' || slType === 'streak_extreme') &&
                renderField('Lookback Period', 'sl_lookback_period', 'number', null, { min: 0 })}
              {(slType === 'lookback_low/high' || slType === 'streak_extreme') &&
                renderField('Lookback TF', 'sl_lookback_timeframe', 'text', TIMEFRAME_OPTIONS)}
            </>
          )}
        </div>

        {slType !== 'pct' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            {renderField('Floor Min %', 'sl_min_pct', 'number', null, { min: 0.1, step: 0.1 })}
            {renderField('Ceiling Max %', 'sl_max_pct', 'number', null, { min: 0.1, step: 0.1 })}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
              <span className="text-[11px] font-semibold text-text truncate">Forming Candle</span>
              <Toggle value={Boolean(cfg.sl_include_forming_candle)} onChange={(v) => setField('sl_include_forming_candle', v)} />
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
              <span className="text-[11px] font-semibold text-text truncate">Reject &gt; Max</span>
              <Toggle value={cfg.reject_entry_if_sl_exceeds_max !== false} onChange={(v) => setField('reject_entry_if_sl_exceeds_max', v)} />
            </div>
          </div>
        )}

        {/* Capital & Portfolio Limits */}
        <div className="pt-2 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {renderField('Risk % / Trade', 'risk_pct_per_trade', 'number', null, { min: 0.1, max: 100, step: 0.1 })}
          {renderField('Max Total Risk %', 'max_total_risk_pct', 'number', null, { min: 0.1, max: 100, step: 0.1 })}
          {renderField('Max Open Trades', 'max_open_trades', 'number', null, { min: 1 })}
          {renderField('Max Per Sym', 'max_open_trades_per_symbol', 'number', null, { min: 1 })}
        </div>

        {/* Active Protection & Anti-Whipsaw Strip */}
        <div className="pt-2 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          {renderField('Whipsaw Candles', 'anti_whipsaw_candle_delay', 'number', null, { min: 0, max: 20 })}
          {renderField('Whipsaw Max TF', 'anti_whipsaw_max_tf', 'text', [...TIMEFRAME_OPTIONS, { value: 'none', label: 'None' }])}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
            <span className="text-[11px] font-semibold text-text truncate">Auto $5.05 Scale</span>
            <Toggle value={cfg.auto_scale_min_notional !== false} onChange={(v) => setField('auto_scale_min_notional', v)} />
          </div>
          {cfg.auto_scale_min_notional !== false ? (
            renderField('Max Overshoot ×', 'auto_scale_max_overshoot', 'number', null, { min: 1, max: 10, step: 0.1 })
          ) : (
            renderField('Max 1-Trade Risk %', 'max_single_trade_risk_pct', 'number', null, { min: 0.1, max: 100, step: 0.5 })
          )}
        </div>

        {(errors?.slippage_warning_threshold || cfg.release_risk_on_est_pnl_be || (slType !== 'pct' && errors?.sl_distance_pct)) && (
          <div className="pt-2 border-t border-border/40 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            {errors?.slippage_warning_threshold &&
              renderField('Slippage warning (%)', 'slippage_warning_threshold', 'number', null, { min: 0, max: 100, step: 0.1 })}
            {slType !== 'pct' && errors?.sl_distance_pct &&
              renderField('Distance %', 'sl_distance_pct', 'number', null, { min: 0.1, max: 50, step: 0.1 })}
            {cfg.release_risk_on_est_pnl_be && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
                <span className="text-[11px] font-semibold text-text truncate">Est. P&amp;L Risk Release</span>
                <Toggle value={true} onChange={(v) => setField('release_risk_on_est_pnl_be', v)} />
              </div>
            )}
          </div>
        )}

        {/* Conditional Active-Only Modifiers */}
        {cfg.martingale_enabled && (
          <div className="pt-2 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            {renderField('Martingale ×', 'martingale_multiplier', 'number', null, { min: 1, max: 10, step: 0.1 })}
            {renderField('Max Steps', 'martingale_max_steps', 'number', null, { min: 1, max: 20 })}
            {renderField('Hard Reset %', 'martingale_reset_threshold_pct', 'number', null, { min: 0.1, max: 100, step: 0.1 })}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
              <span className="text-[11px] font-semibold text-text">Martingale</span>
              <Toggle value={true} onChange={(v) => setField('martingale_enabled', v)} />
            </div>
          </div>
        )}

        {cfg.auto_adjust_max_trades_enabled && (
          <div className="pt-2 border-t border-border/40 grid grid-cols-3 gap-3">
            {renderField('Zero-Risk Min', 'auto_adjust_max_trades_min', 'number', null, { min: 1, max: 20 })}
            {renderField('Zero-Risk Max', 'auto_adjust_max_trades_max', 'number', null, { min: 1, max: 50 })}
            {renderField('Step Size', 'auto_adjust_max_trades_step', 'number', null, { min: 1, max: 5 })}
          </div>
        )}

        {(cfg.frequency_shaping_enabled || Number(cfg.max_trades_per_period) > 0 || Number(cfg.max_trades_24h) > 0) && (
          <div className="pt-2 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {renderField('Period Limit', 'max_trades_per_period', 'number', null, { min: 0 })}
            {renderField('Period (min)', 'trades_period_min', 'number', null, { min: 1 })}
            {renderField('Max 24h', 'max_trades_24h', 'number', null, { min: 0 })}
            {cfg.frequency_shaping_enabled && renderField('Min Interval (m)', 'min_trade_interval_min', 'number', null, { min: 0 })}
          </div>
        )}

        {cfg.risk_use_tod_stats && (
          <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-3 items-end">
            {renderField('Min TOD Winrate %', 'tod_min_winrate', 'number', null, { min: 0, max: 100 })}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-surface/40 min-h-[36px]">
              <span className="text-[11px] font-semibold text-text">Time-of-Day Guard</span>
              <Toggle value={true} onChange={(v) => setField('risk_use_tod_stats', v)} />
            </div>
          </div>
        )}

        {(hasKnifeSignal || cfg.allow_knife_when_gated) && cfg.knife_trailing_enabled !== false && (
          <div className="pt-2 border-t border-border/40 grid grid-cols-3 gap-3">
            {renderField('Knife Trail %', 'knife_trailing_distance_pct', 'number', null, { min: 0.1, max: 10, step: 0.1 })}
            {renderField('Knife BE (R)', 'knife_auto_ratchet_be_rr', 'number', null, { min: 0.1, max: 10, step: 0.1 })}
            {renderField('Knife Lock (R)', 'knife_auto_ratchet_lock_rr', 'number', null, { min: 0.1, max: 10, step: 0.1 })}
          </div>
        )}

        {tradingWindows.length > 0 && (
          <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-dim min-w-0">
              <Clock size={13} className="shrink-0" />
              <span className="font-mono tabular-nums truncate">
                UTC Windows: {tradingWindows.map((w) => `${w?.start || '--'}-${w?.end || '--'}`).join(' · ')}
              </span>
            </div>
            <SectionJumpButton label="Windows" onClick={() => onOpenFullSection('risk', 'risk_temporal')} />
          </div>
        )}
      </section>

      {/* 6. Quiet Discoverability Bar for Inactive Optional Features */}
      {dormantModules.length > 0 && (
        <div className="px-3 py-2.5 rounded-xl border border-dashed border-border/60 bg-background/25 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dim">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="font-semibold text-text/70">Inactive options:</span>
            {dormantModules.map((mod, idx) => (
              <React.Fragment key={mod.label}>
                {idx > 0 && <span aria-hidden="true">·</span>}
                <button
                  type="button"
                  onClick={() => onOpenFullSection(mod.tab, mod.section)}
                  className="hover:text-accent hover:underline transition-colors cursor-pointer"
                >
                  {mod.label}
                </button>
              </React.Fragment>
            ))}
          </div>
          <Briefcase size={12} className="text-dim/60 shrink-0 hidden sm:block" aria-hidden="true" />
        </div>
      )}
    </div>
  );
});
ActiveSummaryPanel.displayName = 'ActiveSummaryPanel';
