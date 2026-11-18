import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGY_NAME_CHAR_LIMITS,
  generateSmartNameSuggestions,
  generateSmartStrategyName,
  getWatchlistScopeDescriptor,
  isGenericStrategyName,
  sanitizeStrategyLabel,
  truncateToCharLimit,
} from '../utils/smartStrategyNaming.js';

test('smartStrategyNaming generates dynamic names for solo gainer, solo loser, and multi-pair strategies within char limits', () => {
  // 1. Solo Gainer (#1 Top Gainer, 1h HTF breakout + 2/5 EMA)
  const soloGainerCfg = {
    watchlist_size: 1,
    watchlist_offset: 0,
    discovery_mode: 'change_pct',
    entry_side: 'long',
    scan_interval: '5m',
    enabled_signals: ['htf_breakout', 'ema_dual'],
    signal_params: {
      htf_breakout_ref_timeframe: '1h',
      htf_breakout_reference_level: 'high_low',
      entry_ema_fast: 2,
      entry_ema_slow: 5,
    },
  };

  const gainerScope = getWatchlistScopeDescriptor(soloGainerCfg);
  assert.equal(gainerScope.mode, 'dynamic_solo');
  assert.equal(gainerScope.isSolo, true);
  assert.match(gainerScope.badge, /Solo #1/);
  assert.match(gainerScope.badge, /Gainer/);

  const gainerName = generateSmartStrategyName(soloGainerCfg, { maxLen: 28, style: 'standard' });
  assert.ok(gainerName.length <= 28, `Expected <= 28 chars, got ${gainerName.length}: "${gainerName}"`);
  assert.match(gainerName, /^Top /);
  assert.match(gainerName, /1h/i);
  assert.match(gainerName, /2 5 ema|2\/5E/);

  // 2. Solo Loser (#1 Bottom Loser, 1h HTF breakout + 2/5 EMA)
  const soloLoserCfg = {
    ...soloGainerCfg,
    discovery_mode: 'loss_pct',
    entry_side: 'short',
  };
  const loserScope = getWatchlistScopeDescriptor(soloLoserCfg);
  assert.equal(loserScope.mode, 'dynamic_solo');
  assert.match(loserScope.badge, /Loser/);

  const loserName = generateSmartStrategyName(soloLoserCfg, { maxLen: 28, style: 'standard' });
  assert.ok(loserName.length <= 28);
  assert.match(loserName, /^(Bottom|Btm) /);

  // 3. Multi-Pair Base Strategy (1D HL 2 5 EMA)
  const multiPairCfg = {
    ...soloGainerCfg,
    watchlist_size: 15,
    signal_params: {
      htf_breakout_ref_timeframe: '1d',
      htf_breakout_reference_level: 'high_low',
      entry_ema_fast: 2,
      entry_ema_slow: 5,
    },
  };
  const multiScope = getWatchlistScopeDescriptor(multiPairCfg);
  assert.equal(multiScope.mode, 'dynamic_multi');
  assert.equal(multiScope.isSolo, false);

  const multiName = generateSmartStrategyName(multiPairCfg, { maxLen: 28, style: 'standard' });
  assert.equal(multiName, '1D hl 2 5 ema');

  // 4. Strict character limit enforcement (20 chars compact)
  const compactSuggestions = generateSmartNameSuggestions(soloLoserCfg, STRATEGY_NAME_CHAR_LIMITS.COMPACT);
  assert.ok(compactSuggestions.length >= 1);
  for (const s of compactSuggestions) {
    assert.ok(s.value.length <= STRATEGY_NAME_CHAR_LIMITS.COMPACT, `Suggestion "${s.value}" exceeded 20 chars`);
  }

  // 5. Generic label detection & sanitization
  assert.equal(isGenericStrategyName('Momentum Strategy'), true);
  assert.equal(isGenericStrategyName('Variant #2'), true);
  assert.equal(isGenericStrategyName('Top hl 1h'), false);
  assert.equal(sanitizeStrategyLabel('My <script>Strategy!', 20), 'My scriptStrategy');
  assert.ok(truncateToCharLimit('Top 1h hl 2 5 ema very long strategy label', 20).length <= 20);
});

test('ConfigModal mounts SavePresetModal at root level outside section === presets so Save As works from any tab or scroll position', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const configModalSource = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/src/components/ConfigModal.jsx'),
    'utf8'
  );

  const presetsSectionIdx = configModalSource.indexOf("{section === 'presets' && (");
  const stickyFooterIdx = configModalSource.indexOf('p-1.5 sm:p-2 border-t border-border bg-surface/95 backdrop-blur-md flex flex-col gap-1.5 sticky bottom-0');
  const savePresetModalMountIdx = configModalSource.indexOf('<SavePresetModal');

  assert.ok(presetsSectionIdx > 0, 'Presets section block should exist');
  assert.ok(stickyFooterIdx > presetsSectionIdx, 'Sticky footer should come after scrollBodyRef');
  assert.ok(
    savePresetModalMountIdx > stickyFooterIdx,
    'SavePresetModal must be mounted at ConfigModal root after scrollBodyRef and sticky footer (not trapped inside section === presets)'
  );
});

