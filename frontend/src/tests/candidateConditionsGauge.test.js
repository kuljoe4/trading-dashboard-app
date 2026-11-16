import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timeframeToMs,
  resolveAntiWhipsawTimeframes,
  evaluateAntiWhipsawStatus,
  resolveDialZone,
  computeConditionMeter,
  computeConditionValueDelta,
  buildMacdFilterModel,
  buildHtfLadderModel,
  buildCandidateConditionsModel,
} from '../utils/candidateConditions.js';

test('CandidateConditionsGauge helper suite', async (t) => {
  await t.test('timeframeToMs handles m, h, d, w, M units', () => {
    assert.strictEqual(timeframeToMs('5m'), 5 * 60 * 1000);
    assert.strictEqual(timeframeToMs('1h'), 60 * 60 * 1000);
    assert.strictEqual(timeframeToMs('1d'), 24 * 60 * 60 * 1000);
    assert.strictEqual(timeframeToMs('1w'), 7 * 24 * 60 * 60 * 1000);
    assert.strictEqual(timeframeToMs('1M'), 30 * 24 * 60 * 60 * 1000);
  });

  await t.test('resolveAntiWhipsawTimeframes honors explicit override and max_tf cap', () => {
    const explicit = resolveAntiWhipsawTimeframes({
      scan_interval: '5m',
      anti_whipsaw_timeframes: ['15m', '1h'],
      enabled_signals: ['ema_dual'],
      signal_timeframes: { ema_dual: '1d' },
    });
    assert.deepStrictEqual(explicit, ['15m', '1h']);

    const capped = resolveAntiWhipsawTimeframes({
      scan_interval: '5m',
      anti_whipsaw_max_tf: '4h',
      enabled_signals: ['ema_dual', 'supertrend'],
      signal_timeframes: { ema_dual: '1d', supertrend: '1h' },
    });
    assert.deepStrictEqual(capped, ['5m', '1h']);
  });

  await t.test('evaluateAntiWhipsawStatus isolates by strategy and computes remaining time accurately', () => {
    const hourMs = 60 * 60 * 1000;
    const now = Math.floor(Date.now() / hourMs) * hourMs + 10 * 60 * 1000; // 10m into current hour

    const baseTrade = {
      symbol: 'LINKUSDT',
      strategy_label: 'Base Strategy',
      status: 'CLOSED',
      entry_ts: now - 3 * 60 * 1000,
      exit_ts: now - 2 * 60 * 1000,
    };
    const failedTrade = {
      symbol: 'SUIUSDT',
      strategy_label: 'Variant Fast',
      status: 'ENTRY_FAILED',
      entry_ts: now - 60 * 1000,
    };

    const variantStatus = evaluateAntiWhipsawStatus('LINKUSDT', {
      strategy_label: 'Variant Fast',
      scan_interval: '5m',
      anti_whipsaw_candle_delay: 1,
      anti_whipsaw_tf_delay_min: 10,
      anti_whipsaw_per_strategy: true,
    }, [baseTrade], now);
    assert.strictEqual(variantStatus.locked, false);

    const baseStatus = evaluateAntiWhipsawStatus('LINKUSDT', {
      strategy_label: 'Base Strategy',
      scan_interval: '5m',
      anti_whipsaw_candle_delay: 0,
      anti_whipsaw_tf_delay_min: 10,
      anti_whipsaw_per_strategy: true,
    }, [baseTrade], now);
    assert.strictEqual(baseStatus.locked, true);
    assert.strictEqual(Math.round(baseStatus.remainingMs / 60000), 8);

    const failedIgnored = evaluateAntiWhipsawStatus('SUIUSDT', {
      strategy_label: 'Variant Fast',
      scan_interval: '5m',
      anti_whipsaw_candle_delay: 1,
    }, [failedTrade], now);
    assert.strictEqual(failedIgnored.locked, false);

    const disabledStatus = evaluateAntiWhipsawStatus('LINKUSDT', {
      strategy_label: 'Base Strategy',
      scan_interval: '1h',
      anti_whipsaw_candle_delay: 0,
      anti_whipsaw_tf_delay_min: 0,
    }, [baseTrade], now);
    assert.strictEqual(disabledStatus.disabled, true);
    assert.strictEqual(disabledStatus.locked, false);
  });

  await t.test('resolveDialZone maps 0-150% into Watching, Near, Fresh, Stale, Late and flags off-scale overshoots', () => {
    assert.deepStrictEqual(resolveDialZone(62), {
      dialZone: 'watching',
      dialStatus: 'Watching',
      dialOverText: '38% to go',
      isOffScale: false,
    });
    assert.deepStrictEqual(resolveDialZone(88), {
      dialZone: 'near',
      dialStatus: 'Near',
      dialOverText: '12% to go',
      isOffScale: false,
    });
    assert.deepStrictEqual(resolveDialZone(103), {
      dialZone: 'fresh',
      dialStatus: 'Fresh',
      dialOverText: '+3% past',
      isOffScale: false,
    });
    assert.deepStrictEqual(resolveDialZone(112), {
      dialZone: 'stale',
      dialStatus: 'Stale',
      dialOverText: '+12% past',
      isOffScale: false,
    });
    assert.deepStrictEqual(resolveDialZone(131), {
      dialZone: 'late',
      dialStatus: 'Late',
      dialOverText: '+31% past',
      isOffScale: false,
    });
    assert.deepStrictEqual(resolveDialZone(150, { rawDialPct: 219 }), {
      dialZone: 'late',
      dialStatus: 'Late',
      dialOverText: '+119% past · off-scale',
      isOffScale: true,
    });
  });

  await t.test('computeConditionMeter reports value + percentage distance to target and unclamped off-scale overshoot', () => {
    const approaching = computeConditionMeter({
      value: 1.42,
      threshold: 2.0,
      unit: '%',
      signalKey: '__velocity__',
      proximity: 71,
    });
    assert.strictEqual(approaching.targetTickPct, 75);
    assert.strictEqual(approaching.meterState, 'approaching');
    assert.ok(approaching.meterFillPct < 75 && approaching.meterFillPct > 40);
    assert.strictEqual(approaching.dialPct, 71);
    assert.strictEqual(approaching.dialZone, 'watching');
    assert.strictEqual(approaching.dialOverText, '29% to go');

    const exceeded = computeConditionMeter({
      value: 2.65,
      threshold: 2.0,
      unit: '%',
      fired: true,
      signalKey: '__velocity__',
      proximity: 100,
    });
    assert.strictEqual(exceeded.meterState, 'exceeded');
    assert.strictEqual(exceeded.dialPct, 132);
    assert.strictEqual(exceeded.dialZone, 'late');
    assert.strictEqual(exceeded.dialOverText, '+32% past');

    // Off-scale velocity: +4.39% against ±2.00% target = +119% past · off-scale
    const offScale = computeConditionMeter({
      value: 4.39,
      threshold: 2.0,
      unit: '%',
      fired: true,
      signalKey: '__velocity__',
      proximity: 100,
    });
    assert.strictEqual(offScale.dialPct, 150);
    assert.strictEqual(offScale.rawDialPct, 219);
    assert.strictEqual(offScale.isOffScale, true);
    assert.strictEqual(offScale.dialOverText, '+119% past · off-scale');
  });

  await t.test('buildHtfLadderModel computes Fresh (0-25%), Stale (25-60%), Late (60-100%), and Rejected (>100%) zones from max_expansion_pct', () => {
    const cfg = {
      scan_interval: '5m',
      entry_side: 'long',
      signal_params: {
        htf_breakout_ref_timeframe: '1d',
        htf_breakout_trigger_timeframe: '1h',
        htf_breakout_mode: 'closed_candle_confirm',
        htf_breakout_max_expansion_pct: 2.0,
      },
    };

    const freshLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 100,
        ref_low: 95,
        live_price: 100.3,
        closed_value: 100.3,
        fired: true,
      },
      strategyConfig: cfg,
      isLong: true,
    });
    assert.strictEqual(freshLadder.zone, 'fresh');
    assert.strictEqual(freshLadder.candleConfirmState, 'closed_beyond');
    assert.strictEqual(Math.round(freshLadder.capUsedPct), 15);

    const wickedLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 100,
        ref_low: 95,
        live_price: 100.25,
        closed_value: 99.8,
        fired: false,
      },
      strategyConfig: cfg,
      isLong: true,
    });
    assert.strictEqual(wickedLadder.candleConfirmState, 'wicked_only');
    assert.strictEqual(wickedLadder.dialPct, 98);

    const rejectedLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 100,
        ref_low: 95,
        live_price: 102.4,
        closed_value: 102.4,
        fired: false,
        rejected: true,
      },
      strategyConfig: cfg,
      isLong: true,
    });
    assert.strictEqual(rejectedLadder.zone, 'rejected');
    assert.strictEqual(rejectedLadder.isOverCap, true);
  });

  await t.test('buildCandidateConditionsModel separates Scanner gate, uses min for ALL composite, and avoids ENTRY READY contradiction when 1/2 signals hit', () => {
    const partialAllModel = buildCandidateConditionsModel({
      opp: {
        symbol: 'ENAUSDT',
        dir: 'long',
        pct: 4.39,
        close: 0.1072,
        signalResult: {
          allFired: true, // even if backend/mock erroneously passed allFired=true, 1/2 under ALL must not be ENTRY READY
          signals: {
            htf_breakout: {
              fired: false,
              value: 0.1060,
              threshold: 0.1080,
              ref_high: 0.1080,
              ref_low: 0.1020,
              threshold_is_price: true,
            },
            ema_dual: {
              fired: true,
              value: 0.1072,
              threshold: 0.1071,
              threshold_is_price: true,
            },
          },
        },
      },
      strategyConfig: {
        strategy_label: 'Breakout ALL',
        scan_interval: '1d',
        scan_pct_threshold: 2.0,
        entry_side: 'long',
        enabled_signals: ['htf_breakout', 'ema_dual'],
        signal_logic: 'all',
        signal_params: {
          htf_breakout_max_expansion_pct: 2.0,
        },
      },
      closedTrades: [],
      nowMs: Date.now(),
    });

    // Scanner is labeled "Scanner" with GATE connector
    assert.strictEqual(partialAllModel.conditions[0].label, 'Scanner');
    assert.strictEqual(partialAllModel.conditions[0].connector, 'GATE');
    assert.strictEqual(partialAllModel.conditions[0].dialOverText, '+119% past · off-scale');

    // Only 1 of 2 enabled entry signals hit
    assert.strictEqual(partialAllModel.firedConditionsCount, 1);
    assert.strictEqual(partialAllModel.totalConditionsCount, 2);
    assert.notStrictEqual(partialAllModel.overallStatus, 'ENTRY READY');

    // Under ALL logic, compositeDialPct equals the weakest signal (htf_breakout), not a blended average
    const htfCond = partialAllModel.conditions[1];
    assert.strictEqual(htfCond.visualization, 'ladder');
    assert.ok(htfCond.ladder);
    assert.strictEqual(partialAllModel.compositeDialPct, htfCond.dialPct);
  });

  await t.test('buildCandidateConditionsModel switches cleanly to In-Position Exit flow with runway', () => {
    const model = buildCandidateConditionsModel({
      opp: { symbol: 'TAOUSDT', dir: 'long', pct: 4.5, close: 215 },
      activeTrade: {
        symbol: 'TAOUSDT',
        direction: 'LONG',
        entry_price: 200,
        current_price: 215,
        current_sl: 202,
        tp_price: 230,
        qty: 1,
        initial_risk_usdt: 10,
        pnl: 15,
        exit_estimation: {
          proximity: 74,
          signalEstimations: {
            supertrend: { proximity: 74, etaCandles: 2.5, state: 'approaching', estimatedPnl: 12, estimatedR: 1.2 },
          },
        },
        exit_signals_status: {
          supertrend: { fired: false, active: true, value: 215, threshold: 205, threshold_is_price: true },
        },
      },
      strategyConfig: {
        strategy_label: 'Base',
        scan_interval: '15m',
        exit_signal_logic: 'any',
        exit_signals: ['supertrend', 'trigger_candle_exit'],
        trigger_candle_exit_timeframe: '1h',
      },
    });

    assert.strictEqual(model.mode, 'in_position');
    assert.strictEqual(model.overallStatus, 'IN POSITION');
    assert.strictEqual(model.compositeProximity, 74);
    assert.strictEqual(model.positionMeta.isProtected, true);
    assert.ok(model.positionMeta.positionRunway);
    assert.ok(model.positionMeta.positionRunway.livePct > model.positionMeta.positionRunway.entryPct);
    assert.strictEqual(model.conditions.length, 2);
    assert.strictEqual(model.conditions[0].proximity, 74);
    assert.strictEqual(model.conditions[0].etaCandles, 2.5);
    assert.strictEqual(model.conditions[1].timeframe, '1h');
    assert.strictEqual(model.conditions[0].evaluatedAtMs, undefined);

    const modelWithScanTs = buildCandidateConditionsModel({
      opp: { symbol: 'TAOUSDT', dir: 'long', pct: 4.5, close: 215 },
      activeTrade: {
        symbol: 'TAOUSDT',
        direction: 'LONG',
        entry_price: 200,
        current_price: 215,
        current_sl: 202,
        tp_price: 230,
        qty: 1,
        initial_risk_usdt: 10,
        pnl: 15,
        exit_signals_status_ts: 1700000090000,
        exit_signals_status: { supertrend: { fired: false, active: true, value: 215, threshold: 205 } },
      },
      strategyConfig: { exit_signals: ['supertrend'] },
      lastScanTs: 1700000080000,
    });
    assert.strictEqual(modelWithScanTs.conditions[0].evaluatedAtMs, 1700000090000);
  });

  await t.test('buildCandidateConditionsModel propagates live opp.lastUpdate/lastScanTs to Scanner Gate & signals while freezing closed snapshots', () => {
    const liveScanTs = 1700000120000;
    const oppLastUpdate = 1700000105000;
    const staleSignalEvalTs = 1700000060000;

    const liveModel = buildCandidateConditionsModel({
      opp: {
        symbol: 'GATEUSDT',
        dir: 'long',
        pct: 3.91,
        close: 1.25,
        lastUpdate: oppLastUpdate,
        signalResult: {
          allFired: false,
          signals: {
            htf_breakout: {
              fired: false,
              value: 1.25,
              threshold: 1.39,
              threshold_is_price: true,
              evaluated_at_ms: staleSignalEvalTs,
            },
          },
        },
      },
      strategyConfig: {
        scan_interval: '5m',
        scan_pct_threshold: 0.2,
        entry_side: 'long',
        enabled_signals: ['htf_breakout'],
      },
      lastScanTs: liveScanTs,
      nowMs: liveScanTs,
    });

    assert.strictEqual(liveModel.conditions[0].connector, 'GATE');
    assert.strictEqual(liveModel.conditions[0].evaluatedAtMs, liveScanTs);
    assert.strictEqual(liveModel.conditions[1].evaluatedAtMs, liveScanTs);

    const snapshotCapturedAt = 1700000010000;
    const frozenModel = buildCandidateConditionsModel({
      opp: {
        symbol: 'GATEUSDT',
        dir: 'long',
        pct: 3.91,
        close: 1.25,
        isEntrySnapshot: true,
        snapshotCapturedAt,
        signalResult: {
          allFired: true,
          signals: {
            htf_breakout: {
              fired: true,
              value: 1.40,
              threshold: 1.39,
              threshold_is_price: true,
              evaluated_at_ms: 1700000005000,
            },
          },
        },
      },
      strategyConfig: {
        scan_interval: '5m',
        scan_pct_threshold: 0.2,
        entry_side: 'long',
        enabled_signals: ['htf_breakout'],
      },
      lastScanTs: liveScanTs,
      nowMs: liveScanTs,
    });

    assert.strictEqual(frozenModel.conditions[0].evaluatedAtMs, snapshotCapturedAt);
    assert.strictEqual(frozenModel.conditions[1].evaluatedAtMs, 1700000005000);
  });

  await t.test('computeConditionValueDelta highlights live value changes, directional arrows, and semantic tone classes', () => {
    const prevCond = {
      liveValue: 98.5,
      liveText: '$98.50',
      dialPct: 82,
      rawDialPct: 82,
      dialZone: 'near',
      unit: '',
      thresholdIsPrice: true,
      stateLabel: 'NEAR',
    };
    const nextCondToward = {
      liveValue: 99.75,
      liveText: '$99.75',
      dialPct: 95,
      rawDialPct: 95,
      dialZone: 'near',
      unit: '',
      thresholdIsPrice: true,
      stateLabel: 'NEAR',
    };

    const deltaToward = computeConditionValueDelta(prevCond, nextCondToward);
    assert.ok(deltaToward);
    assert.strictEqual(deltaToward.changed, true);
    assert.strictEqual(deltaToward.direction, 'toward');
    assert.strictEqual(deltaToward.arrow, '▲');
    assert.strictEqual(deltaToward.dialDelta, 13);
    assert.strictEqual(deltaToward.toneClass, 'text-green');

    const nextCondAway = {
      liveValue: 97.2,
      liveText: '$97.20',
      dialPct: 68,
      rawDialPct: 68,
      dialZone: 'watching',
      unit: '',
      thresholdIsPrice: true,
      stateLabel: 'WATCHING',
    };

    const deltaAway = computeConditionValueDelta(prevCond, nextCondAway);
    assert.ok(deltaAway);
    assert.strictEqual(deltaAway.direction, 'away');
    assert.strictEqual(deltaAway.arrow, '▼');
    assert.strictEqual(deltaAway.dialDelta, -14);
    assert.strictEqual(deltaAway.toneClass, 'text-amber');

    const nextCondOverCap = {
      liveValue: 103.5,
      liveText: '$103.50',
      dialPct: 150,
      rawDialPct: 165,
      dialZone: 'blocked',
      unit: '',
      thresholdIsPrice: true,
      stateLabel: 'REJECTED',
    };

    const deltaOver = computeConditionValueDelta(nextCondToward, nextCondOverCap);
    assert.ok(deltaOver);
    assert.strictEqual(deltaOver.direction, 'over');
    assert.strictEqual(deltaOver.toneClass, 'text-red');

    // Unchanged item returns null so unchanged widgets do not flash
    assert.strictEqual(computeConditionValueDelta(prevCond, { ...prevCond }), null);

    // MACD histogram change triggers delta even when primary EMA dialPct is unchanged
    const prevWithMacd = {
      ...prevCond,
      macdFilter: { enabled: true, histogram: -0.0042, aligned: false },
    };
    const nextWithMacd = {
      ...prevCond,
      macdFilter: { enabled: true, histogram: 0.0018, aligned: true },
    };
    const macdDelta = computeConditionValueDelta(prevWithMacd, nextWithMacd);
    assert.ok(macdDelta);
    assert.strictEqual(macdDelta.histChanged, true);
    assert.strictEqual(macdDelta.alignedChanged, true);
    assert.strictEqual(macdDelta.histArrow, '▲');
    assert.strictEqual(macdDelta.toneClass, 'text-green');
  });

  await t.test('buildMacdFilterModel visualizes EMA Dual MACD filter and standalone MACD signal sub-gates', () => {
    const emaDualMacd = buildMacdFilterModel({
      sigKey: 'ema_dual_cross',
      signalDetail: {
        fired: false,
        rejected: true,
        value: 105.2,
        threshold: 104.8,
        macd_filter: {
          enabled: true,
          mode: 'ema_filter',
          fast: 12,
          slow: 26,
          signal: 9,
          histogram: -0.0245,
          prev_histogram: -0.031,
          recent_hist: [-0.04, -0.035, -0.031, -0.0245],
          aligned: false,
          rejected: true,
          expected_sign: 'positive',
          expected_label: 'Green (+Hist)',
          gates: [
            { key: 'macd_hist', label: 'MACD(12/26/9) > 0 (Green)', passed: false, rejected: true, value: '-0.0245' },
          ],
        },
      },
      isLong: true,
      isExit: false,
    });

    assert.ok(emaDualMacd);
    assert.strictEqual(emaDualMacd.enabled, true);
    assert.strictEqual(emaDualMacd.mode, 'ema_filter');
    assert.strictEqual(emaDualMacd.rejected, true);
    assert.strictEqual(emaDualMacd.aligned, false);
    assert.strictEqual(emaDualMacd.recentHist.length, 4);
    assert.strictEqual(emaDualMacd.gates.length, 1);

    // Fallback synthesis when strategyConfig enables ema_dual_macd_filter
    const fallbackEmaMacd = buildMacdFilterModel({
      sigKey: 'ema_dual',
      signalDetail: {
        fired: false,
        rejected: true,
        description: 'Rejected by MACD (-0.015)',
      },
      strategyConfig: {
        signal_params: {
          ema_dual_macd_filter: true,
          macd_fast: 12,
          macd_slow: 26,
          macd_signal: 9,
        },
      },
      isLong: true,
      isExit: false,
    });
    assert.ok(fallbackEmaMacd);
    assert.strictEqual(fallbackEmaMacd.enabled, true);
    assert.strictEqual(fallbackEmaMacd.rejected, true);
    assert.strictEqual(fallbackEmaMacd.histogram, -0.015);
  });
});


