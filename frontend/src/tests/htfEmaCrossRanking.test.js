import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateHtfEmaCrossFromCandles,
  extractHtfEmaCross,
  compareByHtfEmaCross,
  pickBestRotationCandidate,
  formatHtfCrossCompact,
} from '../utils/htfEmaCross.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..');

function buildCandles(closes, volatility = 0.004) {
  const start = 1700000000000;
  return closes.map((close, idx) => ({
    time: start + idx * 4 * 3600 * 1000,
    open: close * (1 - volatility * 0.2),
    high: close * (1 + volatility),
    low: close * (1 - volatility),
    close,
    volume: 10000 + idx * 100,
  }));
}

describe('HTF EMA Cross Freshness & Suitability Ranking', () => {
  it('scores fresh profitable crossovers strictly higher than stale overextended runs', () => {
    // 1. Fresh profitable setup: historical profitable dip + rebound, then fresh bullish cross near end
    const freshCloses = [];
    for (let i = 0; i < 65; i++) {
      // Smooth sine-like cycle (~20 bars) generating profitable prior crosses, ending right after bullish cross
      freshCloses.push(100 + Math.sin((i - 47) * 0.32) * 8);
    }
    const freshSummary = evaluateHtfEmaCrossFromCandles(buildCandles(freshCloses, 0.002), {
      fastPeriod: 9,
      slowPeriod: 21,
      slDistPct: 1.5,
      interval: '4h',
    });

    // 2. Stale overextended setup: crossed 25+ bars ago and ran far away
    const staleCloses = [];
    for (let i = 0; i < 65; i++) {
      if (i < 25) staleCloses.push(100 - i * 0.25);
      else staleCloses.push(93.75 + (i - 25) * 0.65);
    }
    const staleSummary = evaluateHtfEmaCrossFromCandles(buildCandles(staleCloses, 0.002), {
      fastPeriod: 9,
      slowPeriod: 21,
      slDistPct: 1.5,
      interval: '4h',
    });

    assert.ok(freshSummary, 'fresh setup should evaluate');
    assert.ok(staleSummary, 'stale setup should evaluate');
    assert.ok(
      freshSummary.suitability_score > staleSummary.suitability_score,
      `Expected fresh (${freshSummary.suitability_score}, ${freshSummary.freshness_state}) > stale (${staleSummary.suitability_score}, ${staleSummary.freshness_state})`
    );
    assert.equal(staleSummary.freshness_state, 'stale');
    assert.ok(staleSummary.suitability_score <= 39, `Stale suitability should be capped <=39, got ${staleSummary.suitability_score}`);
  });

  it('orders catalog items deterministically via compareByHtfEmaCross with fresh first and un-warmed last', () => {
    const items = [
      { symbol: 'UNWARMEDUSDT', volume_24h: 900_000_000, score: 85 },
      {
        symbol: 'STALEUSDT',
        volume_24h: 800_000_000,
        htf_ema_cross: {
          interval: '4h',
          freshness_state: 'stale',
          freshness_score: 18,
          suitability_score: 28,
          win_rate: 75,
          bars_since_cross: 18,
          last_cross_direction: 'LONG',
        },
      },
      {
        symbol: 'FRESHUSDT',
        volume_24h: 120_000_000,
        htf_ema_cross: {
          interval: '4h',
          freshness_state: 'fresh',
          freshness_score: 92,
          suitability_score: 86,
          win_rate: 80,
          bars_since_cross: 1,
          last_cross_direction: 'LONG',
        },
      },
      {
        symbol: 'APPROACHUSDT',
        volume_24h: 150_000_000,
        htf_ema_cross: {
          interval: '4h',
          freshness_state: 'approaching',
          freshness_score: 82,
          suitability_score: 77,
          win_rate: 70,
          ema_spread_pct: -0.11,
          bars_since_cross: 7,
          last_cross_direction: 'SHORT',
        },
      },
    ];

    const sorted = [...items].sort(compareByHtfEmaCross);
    assert.deepEqual(
      sorted.map((s) => s.symbol),
      ['FRESHUSDT', 'APPROACHUSDT', 'STALEUSDT', 'UNWARMEDUSDT']
    );
  });

  it('pickBestRotationCandidate prioritizes fresh HTF crosses and switches cleanly to score mode', () => {
    const candidates = [
      {
        symbol: 'PINNEDUSDT',
        score: 99,
        volume_24h: 500_000_000,
        htf_ema_cross: { freshness_state: 'fresh', freshness_score: 98, suitability_score: 96, win_rate: 90 },
      },
      {
        symbol: 'STALEPUMPUSDT',
        score: 94,
        pct: 12.5,
        volume_24h: 400_000_000,
        htf_ema_cross_perf: { freshness_state: 'stale', freshness_score: 15, suitability_score: 26, win_rate: 50 },
      },
      {
        symbol: 'FRESHPAIRUSDT',
        score: 76,
        pct: 3.1,
        volume_24h: 180_000_000,
        htf_ema_cross_perf: { freshness_state: 'fresh', freshness_score: 91, suitability_score: 87, win_rate: 80, bars_since_cross: 1 },
      },
    ];

    const htfPick = pickBestRotationCandidate(candidates, {
      rotateMode: 'htf_ema_cross',
      currentSymbols: new Set(['PINNEDUSDT']),
      activeSymbols: new Set(),
      minScore: 70,
    });
    assert.equal(htfPick?.symbol, 'FRESHPAIRUSDT');

    const scorePick = pickBestRotationCandidate(candidates, {
      rotateMode: 'score',
      currentSymbols: new Set(['PINNEDUSDT']),
      activeSymbols: new Set(),
      minScore: 70,
    });
    assert.equal(scorePick?.symbol, 'STALEPUMPUSDT');
  });

  it('extractHtfEmaCross and formatHtfCrossCompact normalize both catalog and scanner payloads', () => {
    const fromScanner = extractHtfEmaCross({
      symbol: 'BTCUSDT',
      htf_ema_cross_perf: {
        interval: '4h',
        avg_profit_pct: 3.4,
        avg_peak_rr: 2.1,
        win_rate: 75,
        cross_count: 4,
        bars_since_cross: 2,
        last_cross_direction: 'LONG',
        freshness_state: 'fresh',
        freshness_score: 86,
        suitability_score: 82,
      },
    });
    assert.ok(fromScanner);
    assert.equal(fromScanner.freshness_state, 'fresh');
    assert.equal(fromScanner.suitability_score, 82);

    const compact = formatHtfCrossCompact(fromScanner);
    assert.equal(compact?.tone, 'fresh');
    assert.match(compact?.label || '', /^4h Fresh L · 2b · 75%$/);
  });

  it('allows opting out of freshness dampening via preferFresh=false to rank purely by historical profit', () => {
    const staleCloses = [];
    for (let i = 0; i < 65; i++) {
      if (i < 25) staleCloses.push(100 - i * 0.25);
      else staleCloses.push(93.75 + (i - 25) * 0.65);
    }
    const candles = buildCandles(staleCloses, 0.002);
    const withFreshFilter = evaluateHtfEmaCrossFromCandles(candles, {
      fastPeriod: 9,
      slowPeriod: 21,
      slDistPct: 1.5,
      interval: '4h',
      preferFresh: true,
    });
    const withoutFreshFilter = evaluateHtfEmaCrossFromCandles(candles, {
      fastPeriod: 9,
      slowPeriod: 21,
      slDistPct: 1.5,
      interval: '4h',
      preferFresh: false,
    });

    assert.ok(withFreshFilter && withoutFreshFilter);
    assert.equal(withFreshFilter.freshness_state, 'stale');
    assert.ok(withFreshFilter.suitability_score <= 39);
    assert.ok(
      withoutFreshFilter.suitability_score > withFreshFilter.suitability_score,
      `Expected preferFresh=false (${withoutFreshFilter.suitability_score}) > preferFresh=true (${withFreshFilter.suitability_score})`
    );
  });

  it('verifies end-to-end zero-overhead optional wiring across UI, store, server.ts, and NestJS backend', () => {
    const picker = fs.readFileSync(path.join(ROOT, 'frontend/src/components/SymbolCatalogPicker.jsx'), 'utf8');
    const watchlistMgr = fs.readFileSync(path.join(ROOT, 'frontend/src/components/WatchlistManager.jsx'), 'utf8');
    const configModal = fs.readFileSync(path.join(ROOT, 'frontend/src/components/ConfigModal.jsx'), 'utf8');
    const store = fs.readFileSync(path.join(ROOT, 'frontend/src/store/trading.js'), 'utf8');
    const serverTs = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    const marketFeed = fs.readFileSync(path.join(ROOT, 'backend/node/src/engine/market_feed.service.ts'), 'utf8');
    const klineStore = fs.readFileSync(path.join(ROOT, 'backend/node/src/engine/kline_store.service.ts'), 'utf8');

    assert.match(picker, /ema_cross/);
    assert.match(picker, /compareByHtfEmaCross/);
    assert.match(picker, /formatHtfCrossCompact/);
    assert.match(picker, /includeHtfCross:\s*sortBy === 'ema_cross' \|\| htfCatalogEnabled/);

    assert.match(watchlistMgr, /watchlist_rotate_mode/);
    assert.match(watchlistMgr, /Fresh HTF Cross/);

    assert.match(configModal, /watchlist_rotate_mode/);
    assert.match(configModal, /htf_ema_cross_prefer_fresh/);
    assert.match(configModal, /htf_ema_cross_max_bars/);
    assert.match(configModal, /htf_ema_cross_catalog_enabled/);

    assert.match(store, /pickBestRotationCandidate/);
    assert.match(store, /watchlist_rotate_mode/);

    assert.match(serverTs, /\/session\/symbols/);
    assert.match(serverTs, /pickBestRotationCandidate/);
    assert.match(serverTs, /htf_ema_cross_catalog_enabled/);

    // Resource footprint guard: MarketFeedService uses zero-mutation peekRawCandles + bounded cache + opt-in gate
    assert.match(klineStore, /peekRawCandles\(/);
    assert.match(marketFeed, /peekRawCandles\(/);
    assert.match(marketFeed, /catalogHtfCache/);
    assert.match(marketFeed, /includeHtfCross/);
  });
});
