import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSignalLabel,
  getSignalParamsSummary,
  getStrategyRulesDiagnostics,
  buildStrategyNarrative,
  formatDiagnosticDetailEntry,
} from '../utils/strategyDiagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Strategy Diagnostics & UX Clarity', () => {
  test('getSignalParamsSummary resolves signal parameters and timeframes including suffixed variants', () => {
    const config = {
      scan_interval: '5m',
      signal_timeframes: {
        ema_dual_close: '15m',
        htf_breakout: 'default',
        supertrend_2: '1h',
        trigger_candle_exit: '15m',
      },
      exit_signal_delays: {
        macd_fade: 120,
      },
      exit_signal_actions: {
        macd_fade: 'lock_sl',
      },
      signal_params: {
        entry_ema_fast: 12,
        entry_ema_slow: 26,
        ema_dual_macd_filter: true,
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        htf_breakout_ref_timeframe: '1d',
        htf_breakout_trigger_timeframe: '1h',
        htf_breakout_mode: 'close_break',
        htf_breakout_reference_level: 'high_low',
        htf_breakout_lookback: 2,
        htf_breakout_max_expansion_pct: 1.5,
        supertrend_2_period: 14,
        supertrend_2_multiplier: 2.5,
        supertrend_2_mode: 'crossover',
        trigger_candle_exit_n: 1,
        trigger_candle_exit_offset_mode: 'prev_only',
        trigger_candle_exit_mode: 'wick',
      },
    };

    const emaSummary = getSignalParamsSummary(config, 'ema_dual_close', 'entry');
    assert.strictEqual(emaSummary.timeframe, '15m');
    assert.ok(emaSummary.paramsText.includes('EMA 12/26'));
    assert.ok(emaSummary.paramsText.includes('MACD Filter(12/26/9)'));

    const htfSummary = getSignalParamsSummary(config, 'htf_breakout', 'entry');
    assert.strictEqual(htfSummary.timeframe, '1d→1h');
    assert.ok(htfSummary.paramsText.includes('close_break'));
    assert.ok(htfSummary.paramsText.includes('MaxExp≤1.5%'));

    const st2Summary = getSignalParamsSummary(config, 'supertrend_2', 'entry');
    assert.strictEqual(formatSignalLabel('supertrend_2'), 'Supertrend #2');
    assert.strictEqual(st2Summary.timeframe, '1h');
    assert.ok(st2Summary.paramsText.includes('ATR(14)×2.5'));
    assert.ok(st2Summary.paramsText.includes('Crossover'));

    const exitFade = getSignalParamsSummary(config, 'macd_fade', 'exit');
    assert.ok(exitFade.paramsText.includes('Delay 120'));
    assert.ok(exitFade.paramsText.includes('Action:Lock SL'));
  });

  test('getStrategyRulesDiagnostics identifies allowed vs rejected entries, exits, and SL bounds', () => {
    const config = {
      scan_interval: '5m',
      scan_pct_threshold: 1.5,
      scan_lookback: 3,
      entry_side: 'long',
      enabled_signals: ['ema_dual_close', 'macd_impulse'],
      required_signals: ['ema_dual_close'],
      signal_logic: 'combo',
      exit_signals: ['macd_fade'],
      exit_signal_logic: 'any',
      sl_type: 'lookback_low/high',
      sl_lookback_timeframe: '15m',
      sl_lookback_period: 5,
      sl_min_pct: 0.3,
      sl_max_pct: 2.0,
      sl_out_of_bounds_action: 'reject',
      tp_mode: 'exp_rr_seq',
      live_rr_sequence: [1.0, 2.0],
      exit_rr_sequence: [0.0, 1.0],
      risk_pct_per_trade: 1.0,
      max_total_risk_pct: 5.0,
      max_open_trades: 3,
    };

    const focusedOpp = {
      symbol: 'ETHUSDT',
      pct: -2.4,
      dir: 'short',
      sl_dist_pct: 2.8,
      signalResult: {
        allFired: false,
        firedSignals: ['macd_impulse'],
        signals: {
          ema_dual_close: {
            fired: false,
            rejected: true,
            value: 3100,
            threshold: 3120,
            threshold_is_price: true,
            description: 'Rejected by MACD histogram filter',
          },
          macd_impulse: {
            fired: true,
            active: true,
            value: 0.0042,
            threshold: 0,
            description: 'Histogram expanding',
          },
        },
      },
    };

    const diag = getStrategyRulesDiagnostics({
      strategyConfig: config,
      focusedOpp,
      activeTrade: null,
      activeTradeCount: 1,
      totalRiskPct: 1.0,
      startingBal: 10000,
      effectiveGate: 'ACTIVE',
      effectiveReason: 'OK',
      isStrategyPaused: false,
    });

    const sideCheck = diag.entryRules.find(r => r.key === '_entry_side');
    assert.strictEqual(sideCheck.status, 'rejected');

    const emaCheck = diag.entryRules.find(r => r.key === 'ema_dual_close');
    assert.strictEqual(emaCheck.status, 'rejected');
    assert.ok(emaCheck.reasonText.includes('Rejected by MACD histogram filter'));

    const macdCheck = diag.entryRules.find(r => r.key === 'macd_impulse');
    assert.strictEqual(macdCheck.status, 'allowed');

    const slCheck = diag.riskChecks.find(c => c.key === 'sl_bounds');
    assert.strictEqual(slCheck.status, 'rejected');
    assert.ok(slCheck.reasonText.includes('2.80% > Max 2%'));

    const riskCapCheck = diag.riskChecks.find(c => c.key === 'risk_cap');
    assert.ok(!riskCapCheck.configuredText.includes('10x'), 'Deprecated leverage multiplier must not be shown');
  });

  test('getStrategyRulesDiagnostics uses initial_sl for active trade SL bounds even after ratcheting', () => {
    const diag = getStrategyRulesDiagnostics({
      strategyConfig: {
        sl_type: 'pct',
        sl_min_pct: 0.5,
        sl_max_pct: 2.0,
        sl_out_of_bounds_action: 'reject',
        leverage: 20,
      },
      focusedOpp: null,
      activeTrade: {
        symbol: 'BTCUSDT',
        entry_price: 100,
        initial_sl: 99,   // 1.00% -> within bounds
        current_sl: 103,  // Ratcheted to lock +3R -> would falsely trip 2% max if used
      },
      activeTradeCount: 1,
      totalRiskPct: 1.0,
      startingBal: 10000,
      effectiveGate: 'ACTIVE',
      effectiveReason: 'OK',
      isStrategyPaused: false,
    });

    const slCheck = diag.riskChecks.find(c => c.key === 'sl_bounds');
    assert.strictEqual(slCheck.status, 'allowed');
    assert.strictEqual(slCheck.liveText, '1.00%');
    assert.ok(slCheck.reasonText.includes('Initial SL 1.00% within'));
  });

  test('formatDiagnosticDetailEntry formats readable keys/values and omits internal metadata', () => {
    assert.strictEqual(formatDiagnosticDetailEntry('ts_ms', 1700000000000), null);
    assert.strictEqual(formatDiagnosticDetailEntry('id', 'abc-123'), null);
    assert.deepStrictEqual(
      formatDiagnosticDetailEntry('sl_dist_pct', 1.256),
      { label: 'SL Distance', value: '1.26%' }
    );
    assert.deepStrictEqual(
      formatDiagnosticDetailEntry('pnl', -42.5),
      { label: 'PnL', value: '-$42.50' }
    );
  });

  test('buildStrategyNarrative summarizes paused, gated, warming, and active states cleanly', () => {
    const paused = buildStrategyNarrative({
      isStrategyPaused: true,
      streamAgeSec: '1.2',
      formatTimeAgo: () => '5s ago',
      formatClockTime: () => '12:00:00',
    });
    assert.strictEqual(paused.tone, 'warning');
    assert.ok(paused.headline.toLowerCase().includes('paused'));

    const gated = buildStrategyNarrative({
      isStrategyPaused: false,
      effectiveGate: 'max_trades',
      effectiveReason: '3/3 positions open',
      gateUpdatedAt: 1700000000000,
      streamAgeSec: '1.0',
      formatTimeAgo: () => '10s ago',
      formatClockTime: () => '12:00:00',
    });
    assert.strictEqual(gated.tone, 'danger');
    assert.ok(gated.headline.includes('MAX_TRADES'));
    assert.ok(gated.when.includes('10s ago'));
  });

  test('StrategyDetailView implements faceted Decision Log, narrative strip, and clean single-elevation layout', () => {
    const viewPath = path.join(__dirname, '../views/StrategyDetailView.jsx');
    const src = fs.readFileSync(viewPath, 'utf-8');

    assert.ok(src.includes('buildStrategyNarrative'), 'Must render live diagnostic narrative');
    assert.ok(src.includes('getStrategyRulesDiagnostics'), 'Must render entry/exit/risk/SL diagnostic rules');
    assert.ok(src.includes('reasonsOutcome'), 'Must support allowed/rejected/waiting outcome filtering');
    assert.ok(src.includes('reasonsStage'), 'Must support lifecycle stage filtering');
    assert.ok(src.includes('reasonsSymbol'), 'Must support symbol filtering');
    assert.ok(src.includes('hideRoutineMisses'), 'Must support hiding routine scanner misses');
    assert.ok(src.includes("reasonsViewMode === 'story'"), 'Must support By Symbol Story grouping');
    assert.ok(!src.includes('nowMs - 15000'), 'Must not use drifting nowMs fallback timestamps');
  });

  test('StrategyDetailView optimizes very small mobile viewports cleanly', () => {
    const viewPath = path.join(__dirname, '../views/StrategyDetailView.jsx');
    const src = fs.readFileSync(viewPath, 'utf-8');

    assert.ok(src.includes('sticky={false}'), 'Must disable sticky header on StrategyDetailView to preserve mobile viewport space');
    assert.ok(src.includes('hideMetrics'), 'Must hide duplicate global metrics strip in detail ViewHeader');
    assert.ok(src.includes('pb-36'), 'Must clear fixed mobile bottom navigation bar');
    assert.ok(src.includes('grid grid-cols-3'), 'Primary navigation tabs must fit 320px viewports without horizontal scroll');
    assert.ok(src.includes('rulesMobileSection'), 'Must provide mobile section focus filter for Entry/Exit/Risk rules');
    assert.ok(src.includes('visibleReasonsLimit'), 'Must paginate Decision Log items on mobile to avoid double-scroll traps');
    assert.ok(src.includes('sm:max-h-[540px] sm:overflow-y-auto'), 'Decision Log nested scroll must apply only at sm+ breakpoints');
  });
});
