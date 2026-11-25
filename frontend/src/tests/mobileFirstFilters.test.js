import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

test('HistoryView SessionGroup & Main Filter Toolbar use mobile-first grids and touch targets', () => {
  const src = readSrc('views/HistoryView.jsx');

  // SessionGroup modernized filter panel
  assert.ok(src.includes('sessionFilterQuery'), 'SessionGroup supports inline filter search query for large sessions');
  assert.ok(
    src.includes('grid grid-cols-3 sm:inline-flex sm:self-start items-center gap-1 p-1 rounded-xl'),
    'SessionGroup Strategy | Symbol | Pairs switcher uses mobile-first 3-col grid'
  );
  assert.ok(
    src.includes('min-h-[46px] px-3 py-2 rounded-xl border text-left'),
    'SessionGroup filter option cards meet >=44px mobile touch height without horizontal-only clipping'
  );
  assert.ok(
    !src.includes('text-[8.5px] text-dim font-black uppercase tracking-widest flex items-center gap-1 shrink-0'),
    'Cramped 8.5px session filter header label removed'
  );

  // Main HistoryView toolbar
  assert.ok(src.includes('handleResetHistoryFilters'), 'HistoryView top toolbar exposes reset action');
  assert.ok(
    src.includes('grid grid-cols-3 sm:inline-flex items-center gap-1 w-full sm:w-auto'),
    'HistoryView Trade/Session Limit and Sort groups stack into full-width mobile grids'
  );
});

test('App-wide filter bars enforce mobile-first touch sizing and zero blind horizontal clipping', () => {
  const trades = readSrc('views/TradesView.jsx');
  assert.ok(trades.includes('min-h-[38px] sm:min-h-[30px]'), 'TradesView filter buttons meet mobile touch sizing');
  assert.ok(trades.includes('grid grid-cols-3 sm:inline-flex'), 'TradesView Direction and Risk groups use 3-col mobile grid');

  const log = readSrc('components/DecisionLog.jsx');
  assert.ok(log.includes('grid grid-cols-5 sm:inline-flex'), 'DecisionLog Limit selector uses 5-col mobile grid');
  assert.ok(log.includes('min-h-[42px] sm:min-h-[36px]'), 'DecisionLog search input meets mobile touch height');

  const strategyDetail = readSrc('views/StrategyDetailView.jsx');
  assert.ok(
    strategyDetail.includes('role="group"') && strategyDetail.includes('grid grid-cols-3 sm:inline-flex items-center gap-0.5 p-1'),
    'StrategyDetailView snapshot sub-filter spans full width cleanly on mobile'
  );
  assert.ok(strategyDetail.includes('min-h-[40px] sm:min-h-[30px]'), 'StrategyDetailView decision outcome tabs meet mobile touch height');

  const catalog = readSrc('components/SymbolCatalogPicker.jsx');
  assert.ok(catalog.includes('grid grid-cols-2 sm:flex'), 'SymbolCatalogPicker category tabs use 2-col mobile grid');
  assert.ok(catalog.includes('min-h-[38px] sm:min-h-[28px]'), 'SymbolCatalogPicker category buttons meet mobile touch height');

  const config = readSrc('components/ConfigModal.jsx');
  assert.ok(config.includes('grid grid-cols-3 xs:grid-cols-5 sm:flex'), 'ConfigModal preset filter strip wraps cleanly on mobile');
  assert.ok(config.includes('data-testid="presets-usage-filter"') && config.includes('grid grid-cols-4 sm:flex'), 'ConfigModal preset usage filter strip fits 4 tabs cleanly on mobile');
  assert.ok(config.includes('min-h-[38px] sm:min-h-0 sm:h-8'), 'ConfigModal usage and mode filter tabs meet >=38px mobile touch height');
  assert.ok(config.includes('min-h-[42px] sm:min-h-0 sm:h-9'), 'ConfigModal sticky preset search and action bar meets >=42px mobile touch height');

  const metrics = readSrc('components/SystemMetrics.jsx');
  assert.ok(metrics.includes('min-h-[32px] sm:min-h-[24px] px-2.5 py-1 rounded-lg text-[10px]'), 'SystemMetrics REST filter buttons upgrade away from 8px micro chips');

  const watchlist = readSrc('components/WatchlistManager.jsx');
  assert.ok(watchlist.includes('flex flex-wrap items-center gap-1.5 mb-3 pb-2.5'), 'WatchlistManager strategy tabs wrap cleanly on mobile');
});
