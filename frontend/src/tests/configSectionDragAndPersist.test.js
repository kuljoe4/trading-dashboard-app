import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_SECTION_ORDER_STORAGE_KEY,
  TAB_SECTION_DEFAULTS,
  normalizeSectionOrder,
  normalizeSectionOrderMap,
  loadPersistedSectionOrders,
  savePersistedSectionOrders,
  moveSectionInOrder,
  reorderSectionIds,
  mergeVisibleReorder,
  isCustomSectionOrder,
} from '../utils/configSectionOrder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
  };
}

describe('Config sections draggable ordering and persistence', () => {
  test('normalizeSectionOrder preserves custom order, deduplicates, drops invalid keys, and appends newly added defaults', () => {
    const normalized = normalizeSectionOrder(
      'risk',
      ['risk_sl', 'unknown_legacy_section', 'risk_tp', 'risk_sl'],
      TAB_SECTION_DEFAULTS.risk
    );
    assert.deepEqual(normalized, [
      'risk_sl',
      'risk_tp',
      'risk_guards',
      'risk_martingale',
      'risk_temporal',
    ]);
  });

  test('loadPersistedSectionOrders and savePersistedSectionOrders persist custom tab orders cleanly across reloads', () => {
    const storage = createMemoryStorage();

    // Empty storage returns defaults for every tab
    const initial = loadPersistedSectionOrders(storage);
    assert.deepEqual(initial, TAB_SECTION_DEFAULTS);

    // Save custom order for strategy & summary tabs
    const updated = {
      ...initial,
      summary: ['summary_risk', 'summary_entry', 'summary_exit', 'summary_scan', 'summary_env'],
      strategy: ['strategy_exit', 'strategy_entry', 'strategy_timeframes', 'strategy_params', 'strategy_whipsaw', 'strategy_knife'],
    };
    const saved = savePersistedSectionOrders(updated, storage);

    // Verify stored under expected localStorage key and reloaded identically
    const raw = storage.getItem(CONFIG_SECTION_ORDER_STORAGE_KEY);
    assert.ok(raw, 'Persisted JSON should exist in storage');
    const reloaded = loadPersistedSectionOrders(storage);
    assert.deepEqual(reloaded, saved);
    assert.deepEqual(reloaded.summary, ['summary_risk', 'summary_entry', 'summary_exit', 'summary_scan', 'summary_env']);
    assert.deepEqual(reloaded.strategy, ['strategy_exit', 'strategy_entry', 'strategy_timeframes', 'strategy_params', 'strategy_whipsaw', 'strategy_knife']);
    assert.deepEqual(reloaded.scan, TAB_SECTION_DEFAULTS.scan);
  });

  test('loadPersistedSectionOrders recovers gracefully from corrupt storage JSON', () => {
    const storage = createMemoryStorage({
      [CONFIG_SECTION_ORDER_STORAGE_KEY]: '{not-valid-json',
    });
    const loaded = loadPersistedSectionOrders(storage);
    assert.deepEqual(loaded, normalizeSectionOrderMap(null));
  });

  test('moveSectionInOrder and reorderSectionIds support drag-drop and keyboard reordering without mutation', () => {
    const original = ['scan_general', 'scan_htf_cross', 'scan_global', 'scan_watchlist', 'scan_exclusion'];
    const movedUp = moveSectionInOrder(original, 'scan_global', 'up');
    assert.deepEqual(movedUp, ['scan_general', 'scan_global', 'scan_htf_cross', 'scan_watchlist', 'scan_exclusion']);
    // Does not mutate input array
    assert.deepEqual(original, ['scan_general', 'scan_htf_cross', 'scan_global', 'scan_watchlist', 'scan_exclusion']);

    assert.deepEqual(moveSectionInOrder(original, 'scan_general', 'up'), original);
    assert.deepEqual(moveSectionInOrder(original, 'scan_exclusion', 'down'), original);
    assert.deepEqual(moveSectionInOrder(original, 'scan_watchlist', 'top'), ['scan_watchlist', 'scan_general', 'scan_htf_cross', 'scan_global', 'scan_exclusion']);
    assert.deepEqual(moveSectionInOrder(original, 'scan_general', 'bottom'), ['scan_htf_cross', 'scan_global', 'scan_watchlist', 'scan_exclusion', 'scan_general']);

    const dragged = reorderSectionIds(original, 'scan_exclusion', 'scan_htf_cross');
    assert.deepEqual(dragged, ['scan_general', 'scan_exclusion', 'scan_htf_cross', 'scan_global', 'scan_watchlist']);
  });

  test('mergeVisibleReorder preserves conditionally hidden sections and isCustomSectionOrder tracks deviations', () => {
    const full = ['a', 'b', 'c', 'd'];
    const reorderedVisible = ['d', 'a', 'c']; // suppose 'b' was temporarily omitted
    assert.deepEqual(mergeVisibleReorder(full, reorderedVisible), ['d', 'b', 'a', 'c']);

    assert.equal(isCustomSectionOrder('env', ['adv_env', 'adv_capital']), false);
    assert.equal(isCustomSectionOrder('env', ['adv_capital', 'adv_env']), true);
  });

  test('DraggableSectionList uses dedicated handle-only touch/pointer/keyboard controls (never nested inside toggle buttons)', () => {
    const draggableSrc = fs.readFileSync(path.resolve(__dirname, '../components/config/DraggableSectionList.jsx'), 'utf8');
    const configModalSrc = fs.readFileSync(path.resolve(__dirname, '../components/ConfigModal.jsx'), 'utf8');
    const summarySrc = fs.readFileSync(path.resolve(__dirname, '../components/config/ActiveSummaryPanel.jsx'), 'utf8');

    // Dedicated handle-only drag: dragListener={false} + touch-none on GripVertical handle
    assert.match(draggableSrc, /dragListener=\{false\}/);
    assert.match(draggableSrc, /dragControls\.start\(e\)/);
    assert.match(draggableSrc, /touch-none/);
    assert.match(draggableSrc, /e\.key === 'ArrowUp'/);
    assert.match(draggableSrc, /e\.key === 'ArrowDown'/);
    assert.match(draggableSrc, /Reset order/);

    // Drag handle sits in header flex container beside toggle button (valid HTML, no nested <button>)
    assert.match(configModalSrc, /<div className="w-full flex items-center justify-between gap-2 p-2\.5[^>]*>\s*\{dragHandle\}\s*<button/);
    assert.match(summarySrc, /<div className="w-full min-w-0 flex items-center justify-between gap-2 p-2\.5 sm:px-3\.5[^>]*>\s*\{dragHandle\}\s*<button/);
  });
});
