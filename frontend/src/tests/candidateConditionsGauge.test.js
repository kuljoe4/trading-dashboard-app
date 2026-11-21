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
  computeHtfLadderDomain,
  buildCandidateConditionsModel,
  evaluateSlCheck,
  pickNicePercentBound,
  pickNiceRatioMax,
  buildRunwayRTicks,
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

  await t.test('buildHtfLadderModel computes Fresh (0-25%), Stale (25-60%), Late (60-100%), and Rejected (>100%) zones as % of HTF ref candle distance independent of SL', () => {
    // 6% ref candle distance (100 - 94 = 6) with 10% breakout cap -> 0.6% max expansion above level 100 (= 100.6)
    // Intentionally set conflicting sl_distance_pct (2.0%) and sl_max_pct (1.5%) to verify zero SL coupling
    const cfg = {
      scan_interval: '5m',
      entry_side: 'long',
      sl_type: 'pct',
      sl_distance_pct: 2.0,
      sl_max_pct: 1.5,
      signal_params: {
        htf_breakout_ref_timeframe: '1d',
        htf_breakout_trigger_timeframe: '1h',
        htf_breakout_mode: 'closed_candle_confirm',
        htf_breakout_max_expansion_pct: 10,
      },
    };

    const freshLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 100,
        ref_low: 94,
        live_price: 100.12,
        closed_value: 100.12,
        fired: true,
      },
      strategyConfig: cfg,
      isLong: true,
    });
    assert.strictEqual(freshLadder.maxExpansionPct, 10);
    assert.strictEqual(freshLadder.refRangePct, 6);
    assert.strictEqual(freshLadder.effectiveMaxExpPct, 0.6);
    assert.strictEqual(Number(freshLadder.expansionCap.toFixed(2)), 100.6);
    assert.strictEqual(freshLadder.zone, 'fresh');
    assert.strictEqual(freshLadder.candleConfirmState, 'closed_beyond');
    assert.strictEqual(Math.round(freshLadder.capUsedPct), 20);

    const staleLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 100,
        ref_low: 94,
        live_price: 100.3,
        closed_value: 100.3,
        fired: true,
      },
      strategyConfig: cfg,
      isLong: true,
    });
    assert.strictEqual(staleLadder.zone, 'stale');
    assert.strictEqual(Math.round(staleLadder.capUsedPct), 50);

    const wickedLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 100,
        ref_low: 94,
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
        ref_low: 94,
        live_price: 100.7,
        closed_value: 100.7,
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
        sl_type: 'pct',
        sl_distance_pct: 5.0,
        signal_params: {
          htf_breakout_max_expansion_pct: 40,
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

  await t.test('pickNicePercentBound, pickNiceRatioMax, and buildRunwayRTicks produce clean proportionate scales', () => {
    assert.strictEqual(pickNicePercentBound(0.2, 0.5), 0.5);
    assert.strictEqual(pickNicePercentBound(0.8, 1.0), 1);
    assert.strictEqual(pickNicePercentBound(1.5, 1.0), 2);
    assert.strictEqual(pickNicePercentBound(4.2, 1.0), 5);
    assert.strictEqual(pickNicePercentBound(80, 1.0), 50);

    assert.strictEqual(pickNiceRatioMax(120), 150);
    assert.strictEqual(pickNiceRatioMax(160), 200);
    assert.strictEqual(pickNiceRatioMax(219), 300);
    assert.strictEqual(pickNiceRatioMax(420), 500);
    assert.strictEqual(pickNiceRatioMax(800), 1000);

    const ticks = buildRunwayRTicks(-1.1, 3.24, (r) => ((r - (-1.1)) / (3.24 - (-1.1))) * 100);
    const labels = ticks.map((tk) => tk.label);
    assert.ok(labels.includes('-1R'));
    assert.ok(labels.includes('0R'));
    assert.ok(labels.includes('+1R'));
    assert.ok(labels.includes('+2R'));
    assert.ok(labels.includes('+3R'));
    // Strictly monotonic percentages
    for (let i = 1; i < ticks.length; i++) {
      assert.ok(ticks[i].pct > ticks[i - 1].pct);
    }
  });

  await t.test('computeConditionMeter scales EMA / price-level signals linearly in bipolar_pct without 10x amplification', () => {
    // Fast EMA 1.50% past Slow EMA on a 1.0% reference span -> nice bound = ±2%
    const emaPast = computeConditionMeter({
      value: 101.5,
      threshold: 100.0,
      thresholdIsPrice: true,
      isLong: true,
      fired: true,
      signalKey: 'ema_dual',
      isIndicatorPair: true,
      referenceSpanPct: 1.0,
    });
    assert.strictEqual(emaPast.dialScale.mode, 'bipolar_pct');
    assert.strictEqual(emaPast.dialScale.boundPct, 2);
    assert.strictEqual(emaPast.dialScale.centerLabel, 'cross');
    assert.strictEqual(emaPast.dialScale.minLabel, '-2%');
    assert.strictEqual(emaPast.dialScale.maxLabel, '+2%');
    assert.strictEqual(emaPast.dialScale.subText, 'scale ±2%');
    // True signed % readout (NOT +15% past from 10x distortion)
    assert.strictEqual(emaPast.dialOverText, '+1.50% past');
    // Linear proportion: +1.5% out of ±2% => 50 + (1.5/2)*50 = 88%
    assert.strictEqual(emaPast.meterFillPct, 88);

    // Fast EMA 0.50% below Slow EMA on a 1.0% reference span -> nice bound = ±1%
    const emaApproach = computeConditionMeter({
      value: 99.5,
      threshold: 100.0,
      thresholdIsPrice: true,
      isLong: true,
      fired: false,
      signalKey: 'ema_dual',
      isIndicatorPair: true,
      referenceSpanPct: 1.0,
    });
    assert.strictEqual(emaApproach.dialScale.mode, 'bipolar_pct');
    assert.strictEqual(emaApproach.dialScale.boundPct, 1);
    assert.strictEqual(emaApproach.dialOverText, '0.50% to cross');
    // Linear proportion: -0.5% out of ±1% => 50 - 25 = 25%
    assert.strictEqual(emaApproach.meterFillPct, 25);
  });

  await t.test('computeConditionMeter attaches adaptive linear_ratio dialScale for past-target velocity overshoots', () => {
    const overshoot = computeConditionMeter({
      value: 4.39,
      threshold: 2.0,
      unit: '%',
      fired: true,
      signalKey: '__velocity__',
      proximity: 100,
    });
    assert.strictEqual(overshoot.dialScale.mode, 'linear_ratio');
    assert.strictEqual(overshoot.dialScale.maxPct, 300);
    assert.strictEqual(overshoot.dialScale.valuePct, 219);
    assert.strictEqual(overshoot.dialScale.maxLabel, '+200%');
    assert.strictEqual(overshoot.dialScale.subText, '2.19× target');
    assert.strictEqual(overshoot.dialScale.isOffScale, false);
  });

  await t.test('positionRunway preserves exact 1R proportionality when SL trails into profit', () => {
    const model = buildCandidateConditionsModel({
      opp: { symbol: 'TAOUSDT', dir: 'long', pct: 4.5, close: 215 },
      activeTrade: {
        symbol: 'TAOUSDT',
        direction: 'LONG',
        entry_price: 200,
        current_price: 215, // +1.5R (exact midpoint between Entry 200 and TP 230)
        current_sl: 202,    // trailed +0.2R into profit
        tp_price: 230,      // +3.0R
        qty: 1,
        initial_risk_usdt: 10,
        pnl: 15,
        exit_signals_status: {},
      },
      strategyConfig: { exit_signals: [] },
    });
    const rw = model.positionMeta.positionRunway;
    assert.ok(rw);
    assert.strictEqual(Number(rw.slR.toFixed(2)), 0.2);
    assert.strictEqual(Number(rw.currentR.toFixed(2)), 1.5);
    assert.strictEqual(Number(rw.targetR.toFixed(2)), 3.0);
    // Live (+1.5R) must lie at the exact midpoint between Entry (0R) and TP (+3.0R)
    const distEntryToLive = rw.livePct - rw.entryPct;
    const distLiveToTp = rw.tpPct - rw.livePct;
    assert.ok(Math.abs(distEntryToLive - distLiveToTp) <= 0.3, `Expected equal spacing, got ${distEntryToLive} vs ${distLiveToTp}`);
    assert.ok(Array.isArray(rw.rTicks) && rw.rTicks.some((t) => t.label === '0R') && rw.rTicks.some((t) => t.label === '+2R'));
  });

  await t.test('buildHtfLadderModel disables breakout hard cap when max_expansion_pct is 0, preserves opp.sl_dist_pct, and keeps SL Check separate', () => {
    const cfgReject = {
      scan_interval: '5m',
      entry_side: 'long',
      sl_type: 'lookback_low/high',
      sl_lookback_period: 5,
      sl_max_pct: 3.0,
      sl_out_of_bounds_action: 'reject',
      signal_params: {
        htf_breakout_ref_timeframe: '1d',
        htf_breakout_trigger_timeframe: '1h',
        htf_breakout_mode: 'closed_candle_confirm',
        htf_breakout_max_expansion_pct: 0,
      },
    };

    // Case 1: opp.sl_dist_pct (1.80%) must NOT be clobbered by signalDetail.slPrice (1d ref_low = 90)
    // With max_expansion_pct = 0, breakout cap is disabled (no SL max masquerading as breakout cap)
    const withinSlLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      opp: { sl_dist_pct: 1.80, close: 100.5 },
      signalDetail: {
        ref_high: 100,
        ref_low: 90,
        slPrice: 90,
        live_price: 100.5,
        closed_value: 100.5,
        fired: true,
      },
      strategyConfig: cfgReject,
      isLong: true,
    });
    assert.strictEqual(withinSlLadder.capUsesSlLookback, false);
    assert.strictEqual(withinSlLadder.hasHardCap, false);
    assert.strictEqual(withinSlLadder.slDistPct, 1.80);
    assert.strictEqual(Math.round(withinSlLadder.slCapUsedPct), 60);
    assert.strictEqual(withinSlLadder.refRangePct, 10);
    assert.strictEqual(withinSlLadder.zone, 'fresh');
    assert.strictEqual(withinSlLadder.slRejected, false);
    assert.strictEqual(withinSlLadder.isOverCap, false);

    // Case 2: opp.sl_dist_pct 5.4% (> 3.0% sl_max_pct) flags slRejected without falsely tripping breakout isOverCap
    const overSlLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      opp: { sl_dist_pct: 5.4, close: 100.2 },
      signalDetail: {
        ref_high: 100,
        ref_low: 92,
        slPrice: 92,
        live_price: 100.2,
        closed_value: 100.2,
        fired: true,
      },
      strategyConfig: cfgReject,
      isLong: true,
    });
    assert.strictEqual(overSlLadder.slCapHeadroomExhausted, true);
    assert.ok(overSlLadder.expansionCap >= overSlLadder.breakoutLevel, 'expansionCap must not invert below breakoutLevel for LONG');
    assert.strictEqual(overSlLadder.slRejected, true);
    assert.strictEqual(overSlLadder.isOverCap, false);

    // Case 3: With clamp mode, SL exceeding max shows slClamped without rejecting breakout ladder
    const clampedLadder = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      opp: { sl_dist_pct: 4.5, close: 100.2 },
      signalDetail: {
        ref_high: 100,
        ref_low: 92,
        live_price: 100.2,
        closed_value: 100.2,
        fired: true,
      },
      strategyConfig: { ...cfgReject, sl_out_of_bounds_action: 'clamp' },
      isLong: true,
    });
    assert.strictEqual(clampedLadder.slClamped, true);
    assert.strictEqual(clampedLadder.slRejected, false);
    assert.strictEqual(clampedLadder.isOverCap, false);
    assert.strictEqual(clampedLadder.zone, 'fresh');
  });

  await t.test('buildCandidateConditionsModel renders __sl_check__ widget and blocks ENTRY READY when SL exceeds sl_max_pct', () => {
    const baseOpp = {
      symbol: 'KERNELUSDT',
      dir: 'long',
      pct: 3.5,
      close: 101.0,
      sl_dist_pct: 4.5,
      signalResult: {
        allFired: true,
        firedSignals: ['ema_dual'],
        signals: {
          ema_dual: {
            fired: true,
            value: 101.0,
            threshold: 100.2,
            threshold_is_price: true,
          },
        },
      },
    };

    const rejectModel = buildCandidateConditionsModel({
      opp: baseOpp,
      strategyConfig: {
        scan_interval: '5m',
        scan_pct_threshold: 2.0,
        entry_side: 'long',
        enabled_signals: ['ema_dual'],
        signal_logic: 'all',
        sl_type: 'lookback_low/high',
        sl_lookback_period: 5,
        sl_max_pct: 3.0,
        sl_min_pct: 0.3,
        sl_out_of_bounds_action: 'reject',
      },
      closedTrades: [],
    });

    const slCardRej = rejectModel.conditions.find(c => c.key === '__sl_check__');
    assert.ok(slCardRej, 'Entry conditions must include SL Check gate widget');
    assert.strictEqual(slCardRej.connector, 'GATE');
    assert.strictEqual(slCardRej.stateLabel, 'REJECTED');
    assert.strictEqual(slCardRej.dialZone, 'blocked');
    assert.strictEqual(slCardRej.dialOverText, '150% of max SL');
    assert.strictEqual(slCardRej.dialScale.invertTrack, true);
    assert.strictEqual(rejectModel.overallStatus, 'SL EXCEEDS MAX');
    assert.strictEqual(rejectModel.overallTone, 'danger');

    // Clamp action allows entry readiness while flagging CLAMPED on the SL Check widget
    const clampModel = buildCandidateConditionsModel({
      opp: baseOpp,
      strategyConfig: {
        scan_interval: '5m',
        scan_pct_threshold: 2.0,
        entry_side: 'long',
        enabled_signals: ['ema_dual'],
        signal_logic: 'all',
        sl_type: 'lookback_low/high',
        sl_lookback_period: 5,
        sl_max_pct: 3.0,
        sl_min_pct: 0.3,
        sl_out_of_bounds_action: 'clamp',
      },
      closedTrades: [],
    });
    const slCardClamp = clampModel.conditions.find(c => c.key === '__sl_check__');
    assert.ok(slCardClamp);
    assert.strictEqual(slCardClamp.stateLabel, 'CLAMPED');
    assert.strictEqual(slCardClamp.dialZone, 'warming');
    assert.strictEqual(clampModel.overallStatus, 'ENTRY READY');

    // Fixed SL (sl_type === 'pct') does NOT enforce or display sl_max_pct cap percentages
    const fixedSlModel = buildCandidateConditionsModel({
      opp: { ...baseOpp, sl_dist_pct: 6.0 },
      strategyConfig: {
        scan_interval: '5m',
        scan_pct_threshold: 2.0,
        entry_side: 'long',
        enabled_signals: ['ema_dual'],
        signal_logic: 'all',
        sl_type: 'pct',
        sl_distance_pct: 6.0,
        sl_max_pct: 3.0,
        sl_out_of_bounds_action: 'reject',
      },
      closedTrades: [],
    });
    const fixedSlCard = fixedSlModel.conditions.find(c => c.key === '__sl_check__');
    assert.ok(fixedSlCard);
    assert.strictEqual(fixedSlCard.stateLabel, 'PASS');
    assert.strictEqual(fixedSlCard.targetText, 'Fixed SL');
    assert.strictEqual(fixedSlCard.dialOverText, '6.00% fixed');
    assert.strictEqual(fixedSlModel.overallStatus, 'ENTRY READY');

    // Direct evaluateSlCheck sanity check
    const slCheck = evaluateSlCheck({
      opp: { sl_dist_pct: 1.5 },
      strategyConfig: { sl_max_pct: 3.0, sl_min_pct: 0.3, sl_type: 'pct', sl_out_of_bounds_action: 'reject' },
      livePrice: 100,
    });
    assert.strictEqual(slCheck.slCapUsedPct, 50);
    assert.strictEqual(slCheck.slCapRoomPct, 1.5);
    assert.strictEqual(slCheck.slStatus, 'pass');
  });

  await t.test('computeHtfLadderDomain preserves strict 1:1 price proportion when Cap is Off, when Cap is On (up to 6x SL), and when Over Cap (up to 2.5x cap)', () => {
    // 1. Cap Off (Screenshot SHORT scenario: 1d low $3,396.70, live $3,386.15, SL $3,420.01)
    const capOff = computeHtfLadderDomain({
      isLong: false,
      breakoutLevel: 3396.70,
      expansionCap: 3362.73, // synthetic fallback should be ignored when hasHardCap=false
      slPrice: 3420.01,
      livePrice: 3386.15,
      hasHardCap: false,
    });
    assert.strictEqual(capOff.slScaleBreak, false);
    assert.strictEqual(capOff.overCapActive, false);
    // Open skirt below breakoutLevel must NOT inflate to a full synthetic -1.0% ($3,362.73) box larger than SL ($23.31)
    const slSpan = capOff.slVisualPrice - 3396.70; // 23.31
    const breakoutSkirtSpan = 3396.70 - capOff.effectiveCapTarget;
    assert.ok(breakoutSkirtSpan < slSpan, `Expected uncapped skirt (${breakoutSkirtSpan.toFixed(2)}) < SL span (${slSpan.toFixed(2)})`);
    assert.ok(capOff.effectiveCapTarget < 3386.15, 'Live price stays inside open skirt bounds');

    // 2. Cap On with SL = 5x capDist (must remain 1:1 linear without premature scale break)
    const capOnExact = computeHtfLadderDomain({
      isLong: true,
      breakoutLevel: 100.0,
      expansionCap: 100.3, // 0.30% cap
      slPrice: 98.5,       // 1.50% SL = 5.0x capDist
      livePrice: 100.15,   // exact midpoint of cap
      hasHardCap: true,
    });
    assert.strictEqual(capOnExact.slScaleBreak, false);
    assert.strictEqual(capOnExact.slVisualPrice, 98.5);
    const yRatioCap = (100.3 - 100.0) / (capOnExact.pMax - capOnExact.pMin);
    const yRatioSl = (100.0 - 98.5) / (capOnExact.pMax - capOnExact.pMin);
    assert.ok(Math.abs(yRatioSl / yRatioCap - 5.0) < 1e-6, 'SL/Cap pixel ratio must equal exact 5.0:1 price ratio');

    // 3. Over-Cap move at 2.0x capDist past expansionCap must still show true proportion without clamping at 0.36x
    const overCap = computeHtfLadderDomain({
      isLong: true,
      breakoutLevel: 100.0,
      expansionCap: 100.5, // capDist = 0.5
      slPrice: 99.0,
      livePrice: 101.5,    // +1.0 past cap = 2.0x capDist
      hasHardCap: true,
    });
    assert.strictEqual(overCap.overCapActive, true);
    assert.ok(overCap.pMax > 101.5, `Expected pMax (${overCap.pMax}) > livePrice (101.5) for 2.0x over-cap proportion`);

    // 4. Fixed SL ahead of breakoutLevel (Screenshot LONG scenario: 1d high $0.1370, live $0.1393, Fixed SL 1% = $0.13791)
    const slAhead = computeHtfLadderDomain({
      isLong: true,
      breakoutLevel: 0.1370,
      expansionCap: 0.13711,
      slPrice: 0.13791,
      livePrice: 0.1393,
      hasHardCap: true,
    });
    assert.strictEqual(slAhead.slBehindBreakout, false);
    assert.strictEqual(slAhead.slScaleBreak, false);
    assert.strictEqual(slAhead.slVisualPrice, 0.13791, 'SL ahead of breakoutLevel must sit above 1d high, never flipped below it');

    // 5. buildHtfLadderModel must ignore stale un-normalized expansion_cap when effective_max_expansion_pct is absent
    const coherentModel = buildHtfLadderModel({
      sigKey: 'htf_breakout',
      signalDetail: {
        ref_high: 0.1370,
        ref_low: 0.1362,
        live_price: 0.1393,
        closed_value: 0.1393,
        expansion_cap: 0.1507, // stale +10% flat price cap without effective_max_expansion_pct
        fired: true,
      },
      strategyConfig: {
        entry_side: 'long',
        sl_type: 'pct',
        sl_distance_pct: 1.0,
        signal_params: {
          htf_breakout_max_expansion_pct: 10,
        },
      },
      isLong: true,
    });
    assert.ok(Math.abs(coherentModel.expansionCap - 0.13708) < 0.0001, `Expected cap ~0.13708 (10% of 0.0008 span), got ${coherentModel.expansionCap}`);

    // 6. SL below sl_min_pct under 'reject' mode must reject, while 'clamp' widens to sl_min_pct
    const minRej = evaluateSlCheck({
      opp: { sl_dist_pct: 0.12 },
      strategyConfig: { sl_type: 'lookback_low/high', sl_min_pct: 0.3, sl_max_pct: 3.0, sl_out_of_bounds_action: 'reject' },
      livePrice: 100,
    });
    assert.strictEqual(minRej.slBelowMin, true);
    assert.strictEqual(minRej.slRejected, true);
    assert.strictEqual(minRej.slWidened, false);
    assert.strictEqual(minRej.slStatus, 'rejected');

    // 7. When backend clamps wide SL from raw 5.2% -> 3.0%, evaluateSlCheck detects clamping via raw_sl_dist_pct
    const clampedFromBackend = evaluateSlCheck({
      opp: { sl_dist_pct: 3.0, raw_sl_dist_pct: 5.2 },
      strategyConfig: { sl_type: 'lookback_low/high', sl_min_pct: 0.3, sl_max_pct: 3.0, sl_out_of_bounds_action: 'clamp' },
      livePrice: 100,
    });
    assert.strictEqual(clampedFromBackend.slDistPct, 5.2);
    assert.strictEqual(clampedFromBackend.effectiveSlDistPct, 3.0);
    assert.strictEqual(clampedFromBackend.slClamped, true);
    assert.strictEqual(clampedFromBackend.slRejected, false);
  });
});



