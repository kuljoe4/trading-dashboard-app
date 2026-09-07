import { test, describe } from 'node:test';
import assert from 'node:assert';

// Pure implementation of strategy label resolution matching RiskEngineService and ConfigModal
function matchesStrategyLabel(tradeLabel, targetLabel, baseLabel) {
  if (tradeLabel === targetLabel) return true;
  const isTradeBase = !tradeLabel || tradeLabel === 'Momentum Strategy' || tradeLabel === baseLabel;
  const isTargetBase = targetLabel === baseLabel || targetLabel === 'Momentum Strategy';
  return isTargetBase && isTradeBase;
}

function resolveConfigToSaveLabel(cfg, presetName = null, loadedPresetName = null, generatedPresetName = null) {
  const rawLabel = (cfg.strategy_label && cfg.strategy_label !== 'Momentum Strategy')
    ? cfg.strategy_label
    : (presetName || loadedPresetName || cfg.strategy_label || generatedPresetName || 'Momentum Strategy');
  return rawLabel.trim();
}

describe('Dynamic Strategy Label Resolution Unit Tests', () => {
  test('correctly matches trade labels to custom base strategy label when trade is unlabelled or has default Momentum Strategy', () => {
    const baseLabel = 'Custom Breakout 5m';

    // Unlabelled trade -> matches custom base strategy
    assert.strictEqual(matchesStrategyLabel(undefined, baseLabel, baseLabel), true);
    assert.strictEqual(matchesStrategyLabel(null, baseLabel, baseLabel), true);

    // Trade with legacy 'Momentum Strategy' -> matches custom base strategy
    assert.strictEqual(matchesStrategyLabel('Momentum Strategy', baseLabel, baseLabel), true);

    // Trade with explicit custom label -> matches custom base strategy
    assert.strictEqual(matchesStrategyLabel('Custom Breakout 5m', baseLabel, baseLabel), true);

    // Trade with variant label -> does NOT match base strategy
    assert.strictEqual(matchesStrategyLabel('EMA Variant 1', baseLabel, baseLabel), false);
  });

  test('correctly matches trade labels for strategy variants', () => {
    const baseLabel = 'Custom Breakout 5m';
    const variantLabel = 'EMA Variant 1';

    // Trade with variant label -> matches variant
    assert.strictEqual(matchesStrategyLabel('EMA Variant 1', variantLabel, baseLabel), true);

    // Base trade -> does NOT match variant
    assert.strictEqual(matchesStrategyLabel('Custom Breakout 5m', variantLabel, baseLabel), false);
    assert.strictEqual(matchesStrategyLabel('Momentum Strategy', variantLabel, baseLabel), false);
  });

  test('resolves config strategy label prioritizing preset name over default placeholder Momentum Strategy', () => {
    // Case 1: cfg has default 'Momentum Strategy', but loaded preset name is 'Dul 0.8SL'
    const label1 = resolveConfigToSaveLabel(
      { strategy_label: 'Momentum Strategy' },
      'Dul 0.8SL',
      'Dul 0.8SL'
    );
    assert.strictEqual(label1, 'Dul 0.8SL');

    // Case 2: cfg has custom label 'My Alpha Strategy', preset name is 'Dul 0.8SL'
    const label2 = resolveConfigToSaveLabel(
      { strategy_label: 'My Alpha Strategy' },
      'Dul 0.8SL',
      'Dul 0.8SL'
    );
    assert.strictEqual(label2, 'My Alpha Strategy');

    // Case 3: cfg has default 'Momentum Strategy', no preset name provided
    const label3 = resolveConfigToSaveLabel(
      { strategy_label: 'Momentum Strategy' }
    );
    assert.strictEqual(label3, 'Momentum Strategy');
  });
});
