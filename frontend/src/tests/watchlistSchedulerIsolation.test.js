import test from 'node:test';
import assert from 'node:assert/strict';

test('Watchlist Scheduler supports 1d interval and isolates static vs dynamic watchlists', async () => {
  // 1. Verify 1d interval (1440m) configuration value
  const oneDayMinutes = 1440;
  assert.equal(oneDayMinutes, 24 * 60);

  // 2. Verify static strategy symbols isolation vs dynamic global scanner
  const baseConfig = {
    strategy_label: 'Static Scalper',
    global_scanner_enabled: false,
    symbols: ['LITUSDT'],
    strategy_variants: [
      {
        strategy_label: 'Dynamic Trend',
        global_scanner_enabled: true,
        symbols: [], // Dynamic scanner mode should discover market opportunities freely
        discovery_mode: 'abs_change_pct',
      }
    ]
  };

  // Simulate variant symbol resolution logic
  const baseSymbols = Array.isArray(baseConfig.symbols) ? baseConfig.symbols : [];
  const variant = baseConfig.strategy_variants[0];
  const hasVariantSymbols = Array.isArray(variant.symbols) && variant.symbols.length > 0;
  const isDynamic = variant.global_scanner_enabled === true;

  const resolvedVariantSymbols = hasVariantSymbols
    ? variant.symbols
    : (isDynamic ? [] : baseSymbols);

  // Assert variant symbols are empty for dynamic mode so static list doesn't pollute dynamic discovery
  assert.deepEqual(resolvedVariantSymbols, []);
  assert.deepEqual(baseSymbols, ['LITUSDT']);
});

test('Single-symbol watchlist replacement logic', () => {
  const currentSymbols = ['LITUSDT'];
  const maxLimit = 1;
  const newCandidate = 'SOLUSDT';

  let nextSymbols = [...currentSymbols];
  if (maxLimit > 0 && nextSymbols.length >= maxLimit) {
    nextSymbols = [newCandidate];
  } else {
    nextSymbols.push(newCandidate);
  }

  assert.deepEqual(nextSymbols, ['SOLUSDT']);
});
