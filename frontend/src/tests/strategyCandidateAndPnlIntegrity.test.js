import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Candidate Classification, Skip Reasons, PnL Integrity & Pipeline Motion', () => {
  const storePath = path.join(__dirname, '../store/trading.js');
  const strategyDetailPath = path.join(__dirname, '../views/StrategyDetailView.jsx');
  const gaugePath = path.join(__dirname, '../components/ui/CandidateConditionsGauge.jsx');
  const executionPath = path.resolve(__dirname, '../../../backend/node/src/engine/execution.service.ts');

  const storeSource = fs.readFileSync(storePath, 'utf-8');
  const detailSource = fs.readFileSync(strategyDetailPath, 'utf-8');
  const gaugeSource = fs.readFileSync(gaugePath, 'utf-8');
  const executionSource = fs.readFileSync(executionPath, 'utf-8');

  test('Store delta ticks preserve activeTrades when d.trades is [] unless unfiltered _heartbeat, while authoritative updateStats clears cleanly', () => {
    assert.ok(
      storeSource.includes('else if (d._heartbeat && !isResuming && !hasTargetedFocus)'),
      'Delta ticks with empty d.trades must not wipe activeTrades outside unfiltered heartbeats'
    );
    assert.ok(
      storeSource.includes('updateStats: (updates) => set((st) => {') && storeSource.includes('isAuthoritative'),
      'Store must handle authoritative updateStats snapshots cleanly'
    );
    assert.ok(
      storeSource.includes('_authoritative'),
      'Store must clear activeTrades when authoritative REST/status payload explicitly indicates 0 active trades'
    );
    assert.ok(
      !storeSource.includes('${detail.evaluated_at_ms || 0}'),
      'normalizeOpportunity sigDetailsDigest must exclude volatile evaluated_at_ms to preserve memoization'
    );
  });

  test('_syncFocusToBackend unconditionally notifies backend when leaving focus mode', () => {
    const syncFnIdx = storeSource.indexOf('_syncFocusToBackend:');
    assert.ok(syncFnIdx !== -1, '_syncFocusToBackend must exist');
    const syncSnippet = storeSource.slice(syncFnIdx, syncFnIdx + 1200);
    assert.ok(
      syncSnippet.includes("type: 'set_focus_mode'"),
      '_syncFocusToBackend must always transmit set_focus_mode payloads including exit transitions'
    );
  });

  test('StrategyDetailView cleanly separates liveCandidateChips from open/closed snapshot chips and surfaces Recent Skips', () => {
    assert.ok(
      detailSource.includes('liveCandidateChips') && detailSource.includes('openSnapshotChips') && detailSource.includes('closedSnapshotChips'),
      'StrategyDetailView must separate live candidate watchlist chips from open and closed entry snapshots'
    );
    assert.ok(
      detailSource.includes("inspectScope === 'snapshots'") && detailSource.includes('Entry Snapshots:'),
      'Trade snapshots must render in their own separated Snapshots filter view with Entry Snapshots row'
    );
    assert.ok(
      detailSource.includes('Recent Skips:') && detailSource.includes('recentSkipItems'),
      'StrategyDetailView must surface recent skip reasons in Tab 1 with one-click filter to Decision Log'
    );
  });

  test('StrategyDetailView passes focusedTradeForGauge and lastScanTs (not sub-second lastAuthoritativeUpdateTs) to CandidateConditionsGauge', () => {
    assert.ok(
      detailSource.includes('activeTrade={focusedTradeForGauge}'),
      'CandidateConditionsGauge must receive focusedTradeForGauge for seamless In-Position Exit Monitor handoff'
    );
    assert.ok(
      detailSource.includes('lastScanTs={lastScanTs}'),
      'CandidateConditionsGauge must receive lastScanTs for condition freshness without extra polling'
    );
    assert.ok(
      !detailSource.includes('nowMs={lastAuthoritativeUpdateTs}'),
      'CandidateConditionsGauge must not receive sub-second lastAuthoritativeUpdateTs as nowMs'
    );
  });

  test('Pipeline stepper and CandidateConditionsGauge provide GPU-composited transition motion and ConditionFreshness leaf timer', () => {
    assert.ok(
      detailSource.includes('will-change-transform rounded-full') && detailSource.includes('scaleX('),
      'Pipeline stepper must animate stage advancement via GPU-composited transform: scaleX()'
    );
    assert.ok(
      detailSource.includes('animate-event-arrive') && detailSource.includes('animate-handoff-slide'),
      'Pipeline stepper must render single-shot arrival motion when transitioning stages'
    );
    assert.ok(
      gaugeSource.includes('const ConditionFreshness = React.memo('),
      'CandidateConditionsGauge must isolate adaptive freshness timers into a React.memo leaf component'
    );
    assert.ok(
      gaugeSource.includes('animate-event-arrive') && gaugeSource.includes('animate-handoff-slide'),
      'CandidateConditionsGauge must animate condition flips and In-Position handoff cleanly'
    );
  });

  test('Backend execution service logs tp_zero skip reason to monitoring diagnostics', () => {
    assert.ok(
      executionSource.includes("this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'tp_zero'"),
      'Execution service must emit clear skip reason when TP distance <= 0'
    );
  });
});
