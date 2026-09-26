import { test } from 'node:test';
import assert from 'node:assert';
import { calculateProximity, calculateOpportunityProximity } from '../lib/formatters.js';

test('calculateProximity unit tests', async (t) => {
  await t.test('calculateOpportunityProximity calculates consistent composite readiness across views', () => {
    const oppUnfired = {
      symbol: 'BTCUSDT',
      pct: 1.5,
      dir: 'long',
      close: 65000,
      signalResult: {
        allFired: false,
        signals: {
          ema_cross: { fired: false, value: 64800, threshold: 65000, threshold_is_price: true }
        }
      }
    };

    const config = { enabled_signals: ['ema_cross'], scan_pct_threshold: 2.0 };
    const readiness = calculateOpportunityProximity(oppUnfired, config);
    assert.ok(readiness > 0 && readiness < 100, `Unfired composite readiness (${readiness}) should be between 0 and 100%`);

    const oppFired = {
      symbol: 'ETHUSDT',
      pct: 2.5,
      dir: 'long',
      close: 3500,
      signalResult: {
        allFired: true,
        signals: {
          ema_cross: { fired: true, value: 3500, threshold: 3480, threshold_is_price: true }
        }
      }
    };
    const firedReadiness = calculateOpportunityProximity(oppFired, config);
    assert.strictEqual(firedReadiness, 100, 'Fired composite readiness should be strictly 100%');
  });

  await t.test('calculateOpportunityProximity respects signal_logic ALL vs ANY vs COMBO', () => {
    const opp = {
      symbol: 'BTCUSDT',
      pct: 2.0, // 100% velocity progress against scan_pct_threshold: 2.0
      dir: 'long',
      close: 65000,
      signalResult: {
        allFired: false,
        signals: {
          sig1: { fired: false, value: 99, threshold: 100, threshold_is_price: true }, // ~99% prox
          sig2: { fired: false, value: 99, threshold: 100, threshold_is_price: true }, // ~99% prox
          sig3: { fired: false, value: 10, threshold: 100, threshold_is_price: true }, // ~10% prox
        }
      }
    };

    const configAll = { enabled_signals: ['sig1', 'sig2', 'sig3'], signal_logic: 'all', scan_pct_threshold: 2.0 };
    const proxAll = calculateOpportunityProximity(opp, configAll);
    assert.ok(proxAll <= 15, `ALL logic should bottleneck at the lowest signal (~10%), got ${proxAll}%`);

    const configAny = { enabled_signals: ['sig1', 'sig2', 'sig3'], signal_logic: 'any', scan_pct_threshold: 2.0 };
    const proxAny = calculateOpportunityProximity(opp, configAny);
    assert.ok(proxAny >= 90, `ANY logic should take the highest ready signal (~99%), got ${proxAny}%`);

    const configCombo = {
      enabled_signals: ['sig1', 'sig2', 'sig3'],
      signal_logic: 'combo',
      required_signals: ['sig1'],
      scan_pct_threshold: 2.0
    };
    const proxCombo = calculateOpportunityProximity(opp, configCombo);
    // Required sig1 is 99%, optional sig2 (99%) / sig3 (10%) max is 99% -> combo = 99%
    assert.ok(proxCombo >= 90, `COMBO logic with req sig1 (99%) and opt sig2/3 max (99%) should be ~99%, got ${proxCombo}%`);
  });

  await t.test('distinguishes unfired event-based signals from state satisfaction', () => {
    const unfiredEventSignal = {
      key: 'ema_dual_cross',
      value: 99,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    // For SHORT (isLong = false): value 99 < threshold 100 is satisfied side, but fired is false for an event signal.
    // Must return 0 because the cross event occurred previously without firing (blocked/stale).
    const prox = calculateProximity(unfiredEventSignal, 99, 0, false, false);
    assert.strictEqual(prox, 0, 'Unfired event signal must return 0% if satisfied but unfired');
  });

  await t.test('evaluates rejected MACD filter signals as 0% (blocked state)', () => {
    const rejectedSignal = {
      key: 'ema_dual_cross',
      value: 99,
      threshold: 100,
      fired: false,
      rejected: true,
      description: 'EMA(9) crossed EMA(21), but rejected by MACD histogram',
      threshold_is_price: true
    };
    const prox = calculateProximity(rejectedSignal, 99, 0, false, false);
    assert.strictEqual(prox, 0, 'Rejected signal must evaluate to 0% blocked state');
  });
  await t.test('returns 0 for null/undefined/missing signals', () => {
    assert.strictEqual(calculateProximity(null, 100, 100), 0);
  });

  await t.test('returns 0 if insufficientData is true', () => {
    assert.strictEqual(calculateProximity({ insufficientData: true }, 100, 100), 0);
  });

  await t.test('returns 100 if fired and active are true', () => {
    assert.strictEqual(calculateProximity({ fired: true, active: true }, 100, 100), 100);
  });

  await t.test('clamps progress to 99% if not fired yet (price-based)', () => {
    const signal = {
      value: 99.9,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    const res = calculateProximity(signal, 99.9, 95);
    assert.strictEqual(Math.round(res), 98);
  });

  await t.test('handles price-based LONG progress correctly', () => {
    const signal = {
      value: 98,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    // Entry = 90, Mark = 95, Threshold = 100
    // Total distance = 10, Current distance = 5 -> 50%
    const res = calculateProximity(signal, 95, 90);
    assert.strictEqual(res, 50);
  });

  await t.test('handles indicator-based signals with opposite sign guard', () => {
    const signal = {
      value: -1.5,
      threshold: 5.0,
      fired: false
    };
    const res = calculateProximity(signal, 100, 100);
    assert.strictEqual(res, 0); // Opposite signs -> 0
  });

  await t.test('handles indicator-based signals with correct sign', () => {
    const signal = {
      value: 2.5,
      threshold: 5.0,
      fired: false
    };
    const res = calculateProximity(signal, 100, 100);
    assert.strictEqual(res, 50); // 2.5/5.0 -> 50%
  });

  await t.test('handles direction-aware exit signals for LONG when profitable', () => {
    const signal = {
      value: 120,
      threshold: 105,
      fired: false,
      threshold_is_price: true
    };
    // Entry = 100, Threshold = 105, Mark = 120
    // Reference = 5, Distance = 15. Progress = (1 - (15 / 5)) * 100 = -200 -> clamped to 0
    const res = calculateProximity(signal, 120, 100, true, true);
    assert.strictEqual(res, 0);

    // Entry = 100, Threshold = 105, Mark = 106
    // Reference = 5, Distance = 1. Progress = (1 - (1 / 5)) * 100 = 80
    const resNear = calculateProximity(signal, 106, 100, true, true);
    assert.strictEqual(resNear, 80);
  });

  await t.test('handles direction-aware exit signals for SHORT when profitable', () => {
    const signal = {
      value: 95,
      threshold: 105,
      fired: false,
      threshold_is_price: true
    };
    // Entry = 110, Threshold = 105, Mark = 95
    // Reference = 5, Distance = 10. Progress = (1 - (10 / 5)) * 100 = -100 -> clamped to 0
    const res = calculateProximity(signal, 95, 110, false, true);
    assert.strictEqual(res, 0);

    // Entry = 110, Threshold = 105, Mark = 104
    // Reference = 5, Distance = 1. Progress = (1 - (1 / 5)) * 100 = 80
    const resNear = calculateProximity(signal, 104, 110, false, true);
    assert.strictEqual(resNear, 80);
  });

  await t.test('handles dual EMA cross/close when entry is zero or equal to threshold', () => {
    const signal = {
      value: 99.8,
      threshold: 100.0,
      fired: false,
      threshold_is_price: true
    };
    // Spread = 0.2 (0.2% relSpread). Progress = 99 / (1 + 118.75 * 0.002) = 80%
    const res = calculateProximity(signal, 99.8, 0, true, true);
    assert.strictEqual(Math.round(res), 80);
  });

  await t.test('handles dual EMA cross/close for live trades with non-zero entry price', () => {
    const signal = {
      key: 'ema_dual_cross',
      value: 99.8,
      threshold: 100.0,
      metric: 'Exit EMA Dual',
      fired: false,
      threshold_is_price: true
    };
    // Even when entry is 90 and mark is 105, for an EMA dual cross signal, proximity evaluates Fast EMA vs Slow EMA convergence
    // Spread = 0.2 (0.2% relSpread) -> ~80%
    const res = calculateProximity(signal, 105, 90, true, true);
    assert.strictEqual(Math.round(res), 80);
  });

  await t.test('ensures dual params read > 0% no matter how far apart and increase monotonically as they converge', () => {
    const makeSignal = (val) => ({
      key: 'ema_dual_cross',
      value: val,
      threshold: 100.0,
      fired: false,
      threshold_is_price: true
    });

    // Test wide spreads approaching threshold 100.0 for LONG (from below: 50, 80, 90, 95, 99, 99.8)
    const p50 = calculateProximity(makeSignal(50), 50, 0, true, false);
    const p20 = calculateProximity(makeSignal(80), 80, 0, true, false);
    const p10 = calculateProximity(makeSignal(90), 90, 0, true, false);
    const p5  = calculateProximity(makeSignal(95), 95, 0, true, false);
    const p1  = calculateProximity(makeSignal(99), 99, 0, true, false);
    const p02 = calculateProximity(makeSignal(99.8), 99.8, 0, true, false);

    assert.ok(p50 > 0, `p50 (${p50}) should be > 0%`);
    assert.ok(p20 > p50, `p20 (${p20}) should be > p50 (${p50})`);
    assert.ok(p10 > p20, `p10 (${p10}) should be > p20 (${p20})`);
    assert.ok(p5 > p10, `p5 (${p5}) should be > p10 (${p10})`);
    assert.ok(p1 > p5, `p1 (${p1}) should be > p5 (${p5})`);
    assert.ok(p02 > p1, `p02 (${p02}) should be > p1 (${p1})`);
  });

  await t.test('benchmark: calculateOpportunityProximity single-pass loop vs method chaining', () => {
    const opp = {
      symbol: 'BTCUSDT',
      pct: 1.8,
      dir: 'long',
      close: 65000,
      signalResult: {
        allFired: false,
        signals: {
          ema_cross: { fired: false, value: 64900, threshold: 65000, threshold_is_price: true },
          rsi: { fired: false, value: 45, threshold: 50 },
          macd: { fired: false, value: 12, threshold: 15 },
          supertrend: { fired: false, value: 64500, threshold: 64800, threshold_is_price: true },
        }
      }
    };

    const configCombo = {
      enabled_signals: ['ema_cross', 'rsi', 'macd', 'supertrend'],
      signal_logic: 'combo',
      required_signals: ['ema_cross', 'rsi'],
      scan_pct_threshold: 2.0,
    };

    const iterations = 50000;

    // Baseline implementation (functional array chaining)
    const baselineCalculateOpportunityProximity = (oppObj, strategyConfig) => {
      if (!oppObj) return 0;
      if (oppObj.signalResult?.allFired && oppObj.signalResult?.signals) return 100;
      const enabledSigs = strategyConfig.enabled_signals || [];
      const scanThresh = strategyConfig.scan_pct_threshold || 2.0;
      const signalLogic = strategyConfig.signal_logic || 'all';
      const requiredSigs = strategyConfig.required_signals || [];
      const isLong = oppObj.dir === 'long' || (oppObj.pct ?? 0) >= 0;

      const velocityProgress = Math.min(100, (Math.abs(oppObj.pct || 0) / scanThresh) * 100);

      const signalProximities = [];
      if (oppObj.signalResult?.signals) {
        for (const sigKey of enabledSigs) {
          const s = oppObj.signalResult.signals[sigKey];
          if (s) {
            const prox = calculateProximity(s, oppObj.close || s.value || 0, 0, isLong, false);
            signalProximities.push({ key: sigKey, prox });
          }
        }
      }

      let compositeProximity = velocityProgress;
      if (signalProximities.length > 0) {
        if (signalLogic === 'combo') {
          let reqSigs = signalProximities;
          let optSigs = [];
          if (requiredSigs.length > 0) {
            reqSigs = signalProximities.filter(p => requiredSigs.includes(p.key));
            optSigs = signalProximities.filter(p => !requiredSigs.includes(p.key));
          } else {
            reqSigs = [signalProximities[0]];
            optSigs = signalProximities.slice(1);
          }
          const minReqProx = reqSigs.length > 0 ? Math.min(...reqSigs.map(p => p.prox)) : 100;
          const maxOptProx = optSigs.length > 0 ? Math.max(...optSigs.map(p => p.prox)) : 100;
          compositeProximity = Math.min(velocityProgress, minReqProx, maxOptProx);
        }
      }
      return Math.min(99, Math.round(compositeProximity));
    };

    // Warmup
    for (let i = 0; i < 1000; i++) {
      baselineCalculateOpportunityProximity(opp, configCombo);
      calculateOpportunityProximity(opp, configCombo);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      baselineCalculateOpportunityProximity(opp, configCombo);
    }
    const durOrig = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateOpportunityProximity(opp, configCombo);
    }
    const durOpt = performance.now() - t1;

    const speedup = durOrig / Math.max(0.0001, durOpt);
    console.log(`\n⚡ Bolt Performance Benchmark (calculateOpportunityProximity single-pass loop fusion, ${iterations} iterations):`);
    console.log(`  - Original (Array map/filter/spread): ${durOrig.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass loop fusion): ${durOpt.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                  ${speedup.toFixed(2)}x faster\n`);

    assert.strictEqual(
      calculateOpportunityProximity(opp, configCombo),
      baselineCalculateOpportunityProximity(opp, configCombo),
      'Optimized function output must be identical to baseline'
    );
  });
});
