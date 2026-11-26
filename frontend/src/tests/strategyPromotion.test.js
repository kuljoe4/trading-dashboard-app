import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PAST_WEEK_WINDOW_DAYS,
  roundRiskPct,
  computeDoubledRiskPlan,
  computeHalvedRiskPlan,
  resolveStrategyTargetConfig,
  aggregatePastWeekStrategies,
  applyDoubledRiskToConfig,
  applyHalvedRiskToConfig,
  buildActiveConfigPromotionUpdate,
  buildPromotedPresetPayload,
} from '../utils/strategyPromotion.js';
import { CONFIG_LIMITS } from '../constants/configLimits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_SRC_DIR = path.resolve(__dirname, '..');

describe('Past 7 Days Strategy Promotion (2x Risk)', () => {
  test('computeDoubledRiskPlan doubles risk per trade and max strategy risk within bounds', () => {
    const plan = computeDoubledRiskPlan({
      risk_pct_per_trade: 1.0,
      max_total_risk_pct: 5.0,
    });
    assert.equal(plan.currentRiskPerTrade, 1);
    assert.equal(plan.currentMaxTotalRisk, 5);
    assert.equal(plan.nextRiskPerTrade, 2);
    assert.equal(plan.nextMaxTotalRisk, 10);
    assert.equal(plan.canPromote, true);
    assert.equal(plan.isAtMaxCap, false);
    assert.equal(plan.riskClampedByCap, false);
    assert.equal(plan.maxRiskClampedByCap, false);
    assert.equal(plan.hardCapWarning, false);
    assert.equal(plan.currentConcurrentSlots, 5);
    assert.equal(plan.nextConcurrentSlots, 5);
  });

  test('computeDoubledRiskPlan handles fractional precision, 100% cap clamping, and hardCapWarning', () => {
    const fractional = computeDoubledRiskPlan({
      risk_pct_per_trade: 0.33,
      max_total_risk_pct: 1.65,
    });
    assert.equal(roundRiskPct(fractional.nextRiskPerTrade), 0.66);
    assert.equal(roundRiskPct(fractional.nextMaxTotalRisk), 3.3);

    const capped = computeDoubledRiskPlan({
      risk_pct_per_trade: 60,
      max_total_risk_pct: 80,
      risk_hardening_enabled: true,
      max_single_trade_risk_pct: 20,
    });
    assert.equal(capped.nextMaxTotalRisk, 100);
    assert.equal(capped.nextRiskPerTrade, 100);
    assert.equal(capped.maxRiskClampedByCap, true);
    assert.equal(capped.riskClampedByCap, true);
    assert.equal(capped.canPromote, true);
    assert.equal(capped.hardCapWarning, true);
    assert.ok(capped.nextRiskPerTrade <= capped.nextMaxTotalRisk);

    const atCap = computeDoubledRiskPlan({
      risk_pct_per_trade: 100,
      max_total_risk_pct: 100,
    });
    assert.equal(atCap.canPromote, false);
    assert.equal(atCap.isAtMaxCap, true);
    assert.equal(atCap.nextRiskPerTrade, 100);
    assert.equal(atCap.nextMaxTotalRisk, 100);
  });

  test('aggregatePastWeekStrategies filters 7D rolling window, trading mode, and invalid statuses cleanly', () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;

    const trades = [
      // Included Paper Alpha (within 7D)
      {
        id: 't1',
        strategy_label: 'Alpha Scalp',
        trading_mode: 'paper',
        status: 'CLOSED',
        pnl: 120,
        exit_rr: 2.0,
        exit_ts_ms: now - 1 * dayMs,
      },
      {
        id: 't2',
        strategy_label: 'Alpha Scalp',
        trading_mode: 'paper',
        status: 'CLOSED',
        pnl: -40,
        exit_rr: -1.0,
        exit_ts_ms: now - 3 * dayMs,
      },
      // Excluded: older than 7 days
      {
        id: 't3',
        strategy_label: 'Alpha Scalp',
        trading_mode: 'paper',
        status: 'CLOSED',
        pnl: 999,
        exit_ts_ms: now - (PAST_WEEK_WINDOW_DAYS + 0.5) * dayMs,
      },
      // Excluded: wrong status / reconciliation / wrong mode
      {
        id: 't4',
        strategy_label: 'Alpha Scalp',
        trading_mode: 'paper',
        status: 'OPEN',
        pnl: 500,
        exit_ts_ms: now - 1000,
      },
      {
        id: 't5',
        strategy_label: 'Alpha Scalp',
        trading_mode: 'paper',
        status: 'ENTRY_FAILED',
        pnl: -200,
        exit_ts_ms: now - 1000,
      },
      {
        id: 't6',
        strategy_label: 'Alpha Scalp',
        trading_mode: 'paper',
        status: 'CLOSED',
        is_reconciliation: true,
        pnl: 500,
        exit_ts_ms: now - 1000,
      },
      {
        id: 't7',
        strategy_label: 'Live Runner',
        trading_mode: 'live',
        status: 'CLOSED',
        pnl: 300,
        exit_ts_ms: now - 2 * dayMs,
      },
      // Included Paper Beta (negative 7D PnL, variant inheriting base risk)
      {
        id: 't8',
        strategy_label: 'Beta Variant',
        trading_mode: 'paper',
        status: 'CLOSED',
        pnl: -25,
        exit_rr: -0.5,
        exit_ts_ms: now - 2 * dayMs,
      },
    ];

    const activeConfig = {
      strategy_label: 'Alpha Scalp',
      trading_mode: 'paper',
      paper_mode: true,
      risk_pct_per_trade: 1.5,
      max_total_risk_pct: 6.0,
      sl_type: 'supertrend',
      tp_mode: 'exp_rr_seq',
      live_rr_sequence: [1, 2, 4],
      strategy_variants: [
        {
          strategy_label: 'Beta Variant',
          // Inherits risk_pct_per_trade and max_total_risk_pct from activeConfig base!
          sl_type: 'lookback_low/high',
        },
      ],
    };

    const result = aggregatePastWeekStrategies({
      trades,
      sessions: [],
      activeConfig,
      presets: [],
      mode: 'paper',
      nowTs: now,
    });

    assert.equal(result.summary.totalStrategies, 2);
    assert.equal(result.summary.profitableCount, 1);
    assert.equal(result.summary.total7dTrades, 3);
    assert.equal(result.summary.total7dPnl, 55);

    const alpha = result.strategies[0];
    assert.equal(alpha.strategyLabel, 'Alpha Scalp');
    assert.equal(alpha.rank, 1);
    assert.equal(alpha.netPnl, 80);
    assert.equal(alpha.tradesCount, 2);
    assert.equal(alpha.wins, 1);
    assert.equal(alpha.winRate, 50);
    assert.equal(alpha.profitFactor, 3);
    assert.equal(alpha.avgR, 0.5);
    assert.equal(alpha.qualifiesForPromotion, true);
    assert.equal(alpha.locationFlags.isActiveBase, true);
    assert.equal(alpha.riskPlan.nextRiskPerTrade, 3);
    assert.equal(alpha.riskPlan.nextMaxTotalRisk, 12);
    assert.equal(alpha.slDesc.type, 'supertrend');
    assert.equal(alpha.tpDesc.mode, 'exp_rr_seq');

    const beta = result.strategies[1];
    assert.equal(beta.strategyLabel, 'Beta Variant');
    assert.equal(beta.rank, 2);
    assert.equal(beta.qualifiesForPromotion, false);
    assert.equal(beta.locationFlags.isActiveVariant, true);
    assert.equal(beta.locationFlags.variantIndex, 0);
    // Inherited 1.5% / 6.0% from base before doubling!
    assert.equal(beta.riskPlan.currentRiskPerTrade, 1.5);
    assert.equal(beta.riskPlan.currentMaxTotalRisk, 6);
    assert.equal(beta.riskPlan.nextRiskPerTrade, 3);
    assert.equal(beta.riskPlan.nextMaxTotalRisk, 12);
  });

  test('resolveStrategyTargetConfig respects mode isolation and historical session variant snapshots', () => {
    const resolvedCrossMode = resolveStrategyTargetConfig({
      strategyLabel: 'Momentum Pro',
      mode: 'live',
      activeConfig: {
        strategy_label: 'Momentum Pro',
        trading_mode: 'paper',
        paper_mode: true,
        risk_pct_per_trade: 4,
        max_total_risk_pct: 12,
      },
      sessions: [
        {
          id: 'sess-live-1',
          tradingMode: 'live',
          config: {
            strategy_label: 'Base Live',
            trading_mode: 'live',
            risk_pct_per_trade: 0.5,
            max_total_risk_pct: 2.0,
            strategy_variants: [
              { strategy_label: 'Momentum Pro', sl_type: 'pct', sl_distance_pct: 1.2 },
            ],
          },
        },
      ],
    });

    assert.equal(resolvedCrossMode.locationFlags.isActive, false);
    assert.equal(resolvedCrossMode.locationFlags.matchesActiveMode, false);
    assert.equal(resolvedCrossMode.configSource, 'session');
    assert.equal(resolvedCrossMode.effectiveConfig.risk_pct_per_trade, 0.5);
    assert.equal(resolvedCrossMode.effectiveConfig.max_total_risk_pct, 2.0);
    assert.equal(resolvedCrossMode.effectiveConfig.sl_distance_pct, 1.2);
  });

  test('buildActiveConfigPromotionUpdate updates base, variant, and activates inactive strategies immutably', () => {
    const baseCfg = {
      strategy_label: 'Base One',
      trading_mode: 'paper',
      risk_pct_per_trade: 1.0,
      max_total_risk_pct: 5.0,
      strategy_variants: [
        { strategy_label: 'Var One', sl_type: 'supertrend' },
      ],
    };

    const baseUpdate = buildActiveConfigPromotionUpdate({
      activeConfig: baseCfg,
      strategyLabel: 'Base One',
      riskPlan: computeDoubledRiskPlan(baseCfg),
    });
    assert.equal(baseUpdate.appliedAs, 'base');
    assert.equal(baseUpdate.updatedConfig.risk_pct_per_trade, 2.0);
    assert.equal(baseUpdate.updatedConfig.max_total_risk_pct, 10.0);
    assert.equal(baseCfg.risk_pct_per_trade, 1.0); // Immutable original

    const varPlan = computeDoubledRiskPlan(baseCfg);
    const varUpdate = buildActiveConfigPromotionUpdate({
      activeConfig: baseCfg,
      strategyLabel: 'Var One',
      riskPlan: varPlan,
    });
    assert.equal(varUpdate.appliedAs, 'variant');
    assert.equal(varUpdate.variantIndex, 0);
    assert.equal(varUpdate.updatedConfig.strategy_variants[0].risk_pct_per_trade, 2.0);
    assert.equal(varUpdate.updatedConfig.strategy_variants[0].max_total_risk_pct, 10.0);
    assert.equal(varUpdate.updatedConfig.strategy_variants[0].sl_type, 'supertrend');
    assert.equal(baseCfg.strategy_variants[0].risk_pct_per_trade, undefined); // Immutable original

    const newStrategyCfg = applyDoubledRiskToConfig({
      strategy_label: 'Winner X',
      risk_pct_per_trade: 2.0,
      max_total_risk_pct: 8.0,
      sl_type: 'trailing',
    });
    assert.equal(newStrategyCfg.risk_pct_per_trade, 4.0);
    assert.equal(newStrategyCfg.max_total_risk_pct, 16.0);

    const activateVariant = buildActiveConfigPromotionUpdate({
      activeConfig: baseCfg,
      strategyLabel: 'Winner X',
      riskPlan: computeDoubledRiskPlan({ risk_pct_per_trade: 2.0, max_total_risk_pct: 8.0 }),
      fallbackConfig: { strategy_label: 'Winner X', sl_type: 'trailing', strategy_variants: [{ strategy_label: 'nested' }] },
      activateIfInactive: true,
      activationMode: 'variant',
    });
    assert.equal(activateVariant.appliedAs, 'activated_variant');
    assert.equal(activateVariant.updatedConfig.strategy_variants.length, 2);
    assert.deepEqual(activateVariant.updatedConfig.strategy_variants[1].strategy_variants, []);
    assert.equal(activateVariant.updatedConfig.strategy_variants[1].risk_pct_per_trade, 4.0);
    assert.equal(activateVariant.updatedConfig.strategy_variants[1].max_total_risk_pct, 16.0);

    // Enforces MAX_VARIANTS cap cleanly
    const fullCfg = {
      ...baseCfg,
      strategy_variants: Array.from({ length: CONFIG_LIMITS.MAX_VARIANTS }, (_, idx) => ({
        strategy_label: `V${idx}`,
      })),
    };
    const cappedAttempt = buildActiveConfigPromotionUpdate({
      activeConfig: fullCfg,
      strategyLabel: 'Winner Overflow',
      riskPlan: varPlan,
      activateIfInactive: true,
      activationMode: 'variant',
    });
    assert.equal(cappedAttempt.cappedVariants, true);
    assert.equal(cappedAttempt.appliedAs, 'none');
  });

  test('buildPromotedPresetPayload strips nested variants on standalone presets and preserves base variants', () => {
    const standalone = buildPromotedPresetPayload({
      preset: null,
      fallbackConfig: {
        strategy_label: 'Fast Breakout',
        risk_pct_per_trade: 1.0,
        max_total_risk_pct: 4.0,
        paused: true,
        strategy_variants: [{ strategy_label: 'Other' }],
      },
      strategyLabel: 'Fast Breakout',
      riskPlan: computeDoubledRiskPlan({ risk_pct_per_trade: 1.0, max_total_risk_pct: 4.0 }),
    });
    assert.equal(standalone.name, 'Fast Breakout');
    assert.equal(standalone.isExistingPreset, false);
    assert.equal(standalone.payload.risk_pct_per_trade, 2.0);
    assert.equal(standalone.payload.max_total_risk_pct, 8.0);
    assert.deepEqual(standalone.payload.strategy_variants, []);
    assert.equal(standalone.payload.paused, undefined);

    const existingBase = buildPromotedPresetPayload({
      preset: {
        name: 'Master Plan',
        config: {
          strategy_label: 'Master Plan',
          risk_pct_per_trade: 1.0,
          max_total_risk_pct: 5.0,
          strategy_variants: [{ strategy_label: 'Sub V1', risk_pct_per_trade: 0.5 }],
        },
      },
      strategyLabel: 'Master Plan',
      riskPlan: computeDoubledRiskPlan({ risk_pct_per_trade: 1.0, max_total_risk_pct: 5.0 }),
    });
    assert.equal(existingBase.isExistingPreset, true);
    assert.equal(existingBase.payload.risk_pct_per_trade, 2.0);
    assert.equal(existingBase.payload.max_total_risk_pct, 10.0);
    assert.equal(existingBase.payload.strategy_variants.length, 1);
    assert.equal(existingBase.payload.strategy_variants[0].strategy_label, 'Sub V1');
  });

  test('computeHalvedRiskPlan halves risk per trade and max strategy risk with minimum bounds clamping', () => {
    const plan = computeHalvedRiskPlan({
      risk_pct_per_trade: 2.0,
      max_total_risk_pct: 10.0,
    });
    assert.equal(plan.action, 'demote');
    assert.equal(plan.currentRiskPerTrade, 2);
    assert.equal(plan.currentMaxTotalRisk, 10);
    assert.equal(plan.nextRiskPerTrade, 1);
    assert.equal(plan.nextMaxTotalRisk, 5);
    assert.equal(plan.canDemote, true);
    assert.equal(plan.isAtMinCap, false);

    const floorClamped = computeHalvedRiskPlan({
      risk_pct_per_trade: 0.015,
      max_total_risk_pct: 0.12,
    });
    assert.equal(floorClamped.nextRiskPerTrade, CONFIG_LIMITS.RISK_PER_TRADE_MIN);
    assert.equal(floorClamped.nextMaxTotalRisk, CONFIG_LIMITS.MAX_TOTAL_RISK_MIN);
    assert.ok(floorClamped.nextRiskPerTrade <= floorClamped.nextMaxTotalRisk);

    const atMin = computeHalvedRiskPlan({
      risk_pct_per_trade: CONFIG_LIMITS.RISK_PER_TRADE_MIN,
      max_total_risk_pct: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN,
    });
    assert.equal(atMin.canDemote, false);
    assert.equal(atMin.isAtMinCap, true);

    const halvedCfg = applyHalvedRiskToConfig({
      strategy_label: 'Slow Bleed',
      risk_pct_per_trade: 4.0,
      max_total_risk_pct: 12.0,
    });
    assert.equal(halvedCfg.risk_pct_per_trade, 2.0);
    assert.equal(halvedCfg.max_total_risk_pct, 6.0);
  });

  test('aggregatePastWeekStrategies and promotion builders support demotion and optional pause-on-demote', () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    const activeConfig = {
      strategy_label: 'Weak Runner',
      trading_mode: 'paper',
      paper_mode: true,
      risk_pct_per_trade: 2.0,
      max_total_risk_pct: 8.0,
      strategy_variants: [
        { strategy_label: 'Strong Var', risk_pct_per_trade: 1.0, max_total_risk_pct: 4.0 },
      ],
    };

    const agg = aggregatePastWeekStrategies({
      trades: [
        { id: 'd1', strategy_label: 'Weak Runner', trading_mode: 'paper', status: 'CLOSED', pnl: -120, exit_ts_ms: now - dayMs },
        { id: 'd2', strategy_label: 'Strong Var', trading_mode: 'paper', status: 'CLOSED', pnl: 210, exit_ts_ms: now - dayMs },
      ],
      sessions: [],
      activeConfig,
      presets: [],
      mode: 'paper',
      nowTs: now,
    });

    assert.equal(agg.summary.profitableCount, 1);
    assert.equal(agg.summary.underperformingCount, 1);
    const weak = agg.strategies.find((s) => s.strategyLabel === 'Weak Runner');
    assert.equal(weak.qualifiesForPromotion, false);
    assert.equal(weak.qualifiesForDemotion, true);
    assert.equal(weak.demoteRiskPlan.nextRiskPerTrade, 1.0);
    assert.equal(weak.demoteRiskPlan.nextMaxTotalRisk, 4.0);

    const demoteUpdate = buildActiveConfigPromotionUpdate({
      activeConfig,
      strategyLabel: 'Weak Runner',
      riskPlan: weak.demoteRiskPlan,
      action: 'demote',
      pauseStrategy: true,
    });
    assert.equal(demoteUpdate.appliedAs, 'base');
    assert.equal(demoteUpdate.updatedConfig.risk_pct_per_trade, 1.0);
    assert.equal(demoteUpdate.updatedConfig.max_total_risk_pct, 4.0);
    assert.ok(demoteUpdate.updatedConfig.paused_strategies.includes('Weak Runner'));
    assert.equal(activeConfig.paused_strategies, undefined); // Immutable

    const demotePreset = buildPromotedPresetPayload({
      preset: {
        name: 'Weak Runner',
        config: { strategy_label: 'Weak Runner', risk_pct_per_trade: 2.0, max_total_risk_pct: 8.0 },
      },
      strategyLabel: 'Weak Runner',
      riskPlan: weak.demoteRiskPlan,
      action: 'demote',
    });
    assert.equal(demotePreset.payload.risk_pct_per_trade, 1.0);
    assert.equal(demotePreset.payload.max_total_risk_pct, 4.0);
  });

  test('PastWeekPromotionPanel, HistoryView, and ConfigModal follow accessibility and promotion/demotion wiring contracts', () => {
    const panelSrc = fs.readFileSync(path.join(FRONTEND_SRC_DIR, 'components/PastWeekPromotionPanel.jsx'), 'utf-8');
    const historySrc = fs.readFileSync(path.join(FRONTEND_SRC_DIR, 'views/HistoryView.jsx'), 'utf-8');
    const configModalSrc = fs.readFileSync(path.join(FRONTEND_SRC_DIR, 'components/ConfigModal.jsx'), 'utf-8');

    assert.ok(panelSrc.includes('<Dialog.Title'), 'Confirmation dialog must render Dialog.Title');
    assert.ok(panelSrc.includes('<Dialog.Description'), 'Confirmation dialog must render Dialog.Description');
    assert.ok(panelSrc.includes('Demote') && panelSrc.includes('0.5×'), 'PastWeekPromotionPanel must support 0.5x Demote action');
    assert.ok(panelSrc.includes('pauseStrategyOpt'), 'PastWeekPromotionPanel must provide optional pause-on-demote toggle');
    assert.ok(historySrc.includes('<PastWeekPromotionPanel'), 'HistoryView must render PastWeekPromotionPanel');
    assert.ok(historySrc.includes('handlePromotePastWeekStrategy'), 'HistoryView must wire handlePromotePastWeekStrategy');
    assert.ok(historySrc.includes('pauseStrategy'), 'HistoryView must pass pauseStrategy option');
    assert.ok(configModalSrc.includes('<PastWeekPromotionPanel'), 'ConfigModal must render PastWeekPromotionPanel');
    assert.ok(configModalSrc.includes('handlePromotePastWeekFromModal'), 'ConfigModal must wire handlePromotePastWeekFromModal');
    assert.ok(configModalSrc.includes('pauseStrategy'), 'ConfigModal must support pauseStrategy on demote');
  });
});
