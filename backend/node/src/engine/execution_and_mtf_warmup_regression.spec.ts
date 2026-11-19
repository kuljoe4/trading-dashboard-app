import { ExecutionService } from './execution.service';
import { SignalEngineService } from './signalEngine';
import { MomentumScannerService } from './momentum_scanner.service';
import { KlineStoreService, Candle } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('Live Execution, Multi-TF Warmup & Watchlist Alignment Regressions', () => {
  describe('ExecutionService lookback_low/high entry execution', () => {
    it('defines lookbackPeriod and executes computeSl + computePositionSize without ReferenceError', async () => {
      const eventEmitter = { emit: jest.fn() } as any;
      const getLookbackExtremes = jest.fn().mockReturnValue({ minLow: 0.0026, maxHigh: 0.00282, reason: undefined });
      const computeSl = jest.fn().mockReturnValue({ slPrice: 0.00282, rejected: false });
      const computePositionSize = jest.fn().mockReturnValue({ qty: 1000, riskUsdt: 1.36, riskPct: 1.0, rejected: false });
      const executeEntry = jest.fn().mockResolvedValue({
        status: 'SUCCESS',
        trade: { id: 't1', symbol: 'PUMPUSDT', side: 'SHORT', qty: 1000, entry_price: 0.00274 },
      });

      const exec = new ExecutionService(
        {
          getPrice: () => 0.00274,
          getTicker: () => ({ price: 0.00274, markPrice: 0.00274 }),
        } as any,
        {
          getRawCandles: () => [],
          getLookbackExtremes,
        } as any,
        {
          checkEntry: () => ({ allFired: true, firedSignals: ['htf_breakout', 'ema_dual'], details: {}, reason: 'ok' }),
        } as any,
        {
          computeSl,
          computePositionSize,
          computeTp: jest.fn().mockReturnValue(0.00259),
          canEnter: () => ({ canEnter: true, reason: 'OK' }),
        } as any,
        {
          activeList: () => [],
          hasSymbol: () => false,
          countByStrategy: () => 0,
          enteringCount: () => 0,
          totalRisk: () => 0,
          isEntering: () => false,
          setEntering: jest.fn(),
          add: jest.fn(),
          peakRrSwitchHits: new Map(),
        } as any,
        {
          applyFilters: (_sym: string, price: number, qty: number) => ({ price, qty, valid: true }),
          enter: executeEntry,
        } as any,
        {
          getBalance: () => 136,
          isBanned: () => false,
          isGeoBlocked: () => false,
          entryInProgress: false,
          realTimePositions: new Map(),
          isPaused: false,
          isStrategyPaused: () => false,
          pausedStrategies: new Set(),
          closedTrades: [],
        } as any,
        {
          isExecutionAllowed: () => true,
          getStrategyGateState: () => ({ gateState: 'ACTIVE' }),
        } as any,
        { broadcast: jest.fn() } as any,
        { setLoopStage: jest.fn() } as any,
        { serializeTrade: jest.fn((t: any) => t) } as any,
        eventEmitter,
        {} as any,
        {
          resolveInterval: (v: string) => v || '1d',
          queueBackfill: jest.fn(),
          getSymbolFilters: () => ({ tickSize: 0.0000001, stepSize: 1, minNotional: 5 }),
        } as any,
      );

      const opp: any = {
        symbol: 'PUMPUSDT',
        direction: 'SHORT',
        dir: 'short',
        pct: -6.25,
        price: 0.00274,
        strategy_label: '1D hl 2 5 ema',
        signalResult: { allFired: true, firedSignals: ['htf_breakout', 'ema_dual'] },
      };

      const cfg: Partial<SessionConfig> = {
        strategy_label: '1D hl 2 5 ema',
        trading_mode: 'paper',
        paper_mode: true,
        scan_interval: '1d',
        entry_side: 'both',
        sl_type: 'lookback_low/high',
        sl_lookback_timeframe: '1d',
        sl_lookback_period: 1,
        sl_include_forming_candle: false,
        sl_min_pct: 0.3,
        sl_max_pct: 20,
        sl_out_of_bounds_action: 'reject',
        risk_pct_per_trade: 1.0,
        max_total_risk_pct: 2.2,
        max_open_trades: 5,
      };

      await exec.processEntries([opp], cfg as SessionConfig, '1D hl 2 5 ema', async () => {});

      expect(getLookbackExtremes).toHaveBeenCalledWith('PUMPUSDT', '1d', 1, false);
      expect(computeSl).toHaveBeenCalled();
      expect(computePositionSize).toHaveBeenCalled();
      expect(executeEntry).toHaveBeenCalled();
    });

    it('preserves sl_lookback_period = 0 instead of falling back to 5', async () => {
      const getLookbackExtremes = jest.fn().mockReturnValue({ minLow: 98, maxHigh: 102, reason: undefined });
      const computeSl = jest.fn().mockReturnValue({ slPrice: 102, rejected: true, reason: 'SL rejected' });

      const exec = new ExecutionService(
        { getPrice: () => 100, getTicker: () => ({ price: 100 }) } as any,
        { getRawCandles: () => [], getLookbackExtremes } as any,
        { checkEntry: () => ({ allFired: true, firedSignals: ['momentum_pct'], details: {}, reason: 'ok' }) } as any,
        { computeSl } as any,
        { activeList: () => [], hasSymbol: () => false, countByStrategy: () => 0, peakRrSwitchHits: new Map() } as any,
        {} as any,
        {
          getBalance: () => 1000,
          isBanned: () => false,
          isGeoBlocked: () => false,
          entryInProgress: false,
          realTimePositions: new Map(),
          isPaused: false,
          isStrategyPaused: () => false,
          pausedStrategies: new Set(),
          closedTrades: [],
        } as any,
        { isExecutionAllowed: () => true, getStrategyGateState: () => ({ gateState: 'ACTIVE' }) } as any,
        { broadcast: jest.fn() } as any,
        { setLoopStage: jest.fn() } as any,
        {} as any,
        { emit: jest.fn() } as any,
        {} as any,
        { resolveInterval: (v: string) => v || '1d', queueBackfill: jest.fn(), getSymbolFilters: () => null } as any,
      );

      await exec.processEntries(
        [{ symbol: 'BTCUSDT', direction: 'SHORT', dir: 'short', price: 100, signalResult: { allFired: true } }],
        { strategy_label: 'Base', scan_interval: '1d', sl_type: 'lookback_low/high', sl_lookback_period: 0 } as SessionConfig,
        'Base',
      );

      expect(getLookbackExtremes).toHaveBeenCalledWith('BTCUSDT', '1d', 0, false);
    });
  });

  describe('SignalEngineService multi-timeframe warmup isolation (RAREUSDT 60/70)', () => {
    const makeCandles = (count: number, startClose: number, stepClose: number, lowOffset = 1, highOffset = 1): Candle[] =>
      Array.from({ length: count }, (_, i) => {
        const close = startClose + i * stepClose;
        return {
          time: (i + 1) * 3600_000,
          open: close - stepClose * 0.5,
          high: close + highOffset,
          low: close - lowOffset,
          close,
          volume: 1000,
        };
      });

    it('evaluates 1d base + htf_breakout (1d->5m) + ema_dual (1h, MACD 12/26/9) cleanly when 1d has 60 candles and 1h has 80 candles', () => {
      // 60 daily candles (< 70), last completed daily high = 100, forming = 102
      const candles1d = makeCandles(60, 40, 1, 2, 0.5);
      candles1d[58] = { time: 59 * 86400_000, open: 97, high: 100, low: 95, close: 99, volume: 5000 };
      candles1d[59] = { time: 60 * 86400_000, open: 99, high: 103, low: 98, close: 102, volume: 5000 };

      // 80 hourly candles (>= 70 for MACD 12/26/9) accelerating upward so EMA 2 > EMA 5 and MACD hist > 0
      const candles1h: Candle[] = Array.from({ length: 80 }, (_, i) => {
        const close = 50 + i * 0.4 + (i >= 50 ? (i - 50) * (i - 50) * 0.03 : 0);
        return {
          time: (i + 1) * 3600_000,
          open: close - 0.3,
          high: close + 0.5,
          low: close - 0.5,
          close,
          volume: 1000,
        };
      });

      // 5m trigger candles above 100 prev-day high (closed_candle_confirm)
      const candles5m: Candle[] = [
        { time: 1000, open: 99, high: 102, low: 98.5, close: 101.5, volume: 500 },
        { time: 2000, open: 101.5, high: 102.5, low: 101, close: 102, volume: 500 },
      ];

      const klineStore = {
        getRawCandles: jest.fn((_sym: string, interval: string) => {
          if (interval === '1d') return candles1d;
          if (interval === '1h') return candles1h;
          if (interval === '5m') return candles5m;
          return [];
        }),
      } as any as KlineStoreService;

      const signalEngine = new SignalEngineService(klineStore);
      const config: Partial<SessionConfig> = {
        scan_interval: '1d',
        scan_lookback: 3,
        enabled_signals: ['htf_breakout', 'ema_dual'],
        signal_logic: 'all',
        signal_timeframes: { ema_dual: '1h' },
        signal_params: {
          htf_breakout_ref_timeframe: '1d',
          htf_breakout_trigger_timeframe: '5m',
          htf_breakout_mode: 'closed_candle_confirm',
          htf_breakout_lookback: 1,
          htf_breakout_max_expansion_pct: 5,
          entry_ema_fast: 2,
          entry_ema_slow: 5,
          ema_dual_macd_filter: true,
          macd_fast: 12,
          macd_slow: 26,
          macd_signal: 9,
        },
      };

      // Non-minimal must evaluate both signals and fire instead of blocking with 60/70 on 1d
      const fullRes = signalEngine.checkEntry('RAREUSDT', config as SessionConfig, '1d', 'LONG', 'entry', false);
      expect(fullRes.reason).not.toContain('60/70');
      expect(fullRes.allFired).toBe(true);
      expect(fullRes.firedSignals).toEqual(['htf_breakout', 'ema_dual']);

      // Minimal mode must also return true
      const minRes = signalEngine.checkEntry('RAREUSDT', config as SessionConfig, '1d', 'LONG', 'entry', true);
      expect(minRes.allFired).toBe(true);
    });

    it('blocks cleanly in both minimal and non-minimal mode with 1h timeframe info when 1h actually lacks MACD warmup candles', () => {
      const candles1d = makeCandles(60, 40, 1);
      candles1d[58] = { time: 59 * 86400_000, open: 97, high: 100, low: 95, close: 99, volume: 5000 };
      const candles1hShort = makeCandles(35, 50, 0.7); // < 70 required by MACD(12/26/9)
      const candles5m: Candle[] = [
        { time: 1000, open: 99, high: 102, low: 98.5, close: 101.5, volume: 500 },
        { time: 2000, open: 101.5, high: 102.5, low: 101, close: 102, volume: 500 },
      ];

      const klineStore = {
        getRawCandles: jest.fn((_sym: string, interval: string) => {
          if (interval === '1d') return candles1d;
          if (interval === '1h') return candles1hShort;
          if (interval === '5m') return candles5m;
          return [];
        }),
      } as any as KlineStoreService;

      const signalEngine = new SignalEngineService(klineStore);
      const config: Partial<SessionConfig> = {
        scan_interval: '1d',
        enabled_signals: ['htf_breakout', 'ema_dual'],
        signal_logic: 'all',
        signal_timeframes: { ema_dual: '1h' },
        signal_params: {
          htf_breakout_ref_timeframe: '1d',
          htf_breakout_trigger_timeframe: '5m',
          htf_breakout_mode: 'closed_candle_confirm',
          htf_breakout_lookback: 1,
          htf_breakout_max_expansion_pct: 5,
          entry_ema_fast: 2,
          entry_ema_slow: 5,
          ema_dual_macd_filter: true,
        },
      };

      const minRes = signalEngine.checkEntry('RAREUSDT', config as SessionConfig, '1d', 'LONG', 'entry', true);
      expect(minRes.allFired).toBe(false);
      expect(minRes.reason).toContain('1h');

      const fullRes = signalEngine.checkEntry('RAREUSDT', config as SessionConfig, '1d', 'LONG', 'entry', false);
      expect(fullRes.allFired).toBe(false);
      expect(fullRes.details?.ema_dual?.insufficientData).toBe(true);
      expect(fullRes.details?.ema_dual?.timeframe).toBe('1h');
    });
  });

  describe('MomentumScannerService Top-50 preservation, queueBackfill on 0/4 candles & forming-candle SL alignment', () => {
    it('preserves >15 candidates up to watchlist_size=50 and queues backfill on insufficient candles', () => {
      const top50 = Array.from({ length: 30 }, (_, i) => ({ symbol: `SYM${i}USDT` }));
      const validCandles: Candle[] = [
        { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
        { time: 2000, open: 100, high: 102, low: 99, close: 101, volume: 10 },
        { time: 3000, open: 101, high: 104, low: 100, close: 103, volume: 10 },
        { time: 4000, open: 103, high: 106, low: 102, close: 105, volume: 10 },
      ];
      const queueBackfill = jest.fn();
      const klineStore = {
        getRawCandles: jest.fn((sym: string) => (sym === 'SYM29USDT' ? [] : validCandles)),
      } as any;
      const tickerCache = {
        getPrice: jest.fn(() => 105),
        getTicker: jest.fn(() => ({ price: 105, volume_24h: 1000000 })),
        topByVolume: jest.fn(() => top50),
      } as any;
      const marketFeed = {
        resolveInterval: jest.fn((v: string) => v || '1d'),
        getSymbolFilters: jest.fn(() => ({ filters: [] })),
        queueBackfill,
      } as any;

      const scanner = new MomentumScannerService(klineStore, tickerCache, marketFeed);
      const opps = scanner.scan({
        global_scanner_enabled: true,
        watchlist_size: 50,
        scan_interval: '1d',
        scan_lookback: 3,
        scan_pct_threshold: 1.0,
        sl_max_pct: 20,
      } as SessionConfig);

      // 29 symbols pass instead of getting cut off at 15, and missing candle symbol queued backfill
      expect(opps.length).toBe(29);
      expect(queueBackfill).toHaveBeenCalledWith('SYM29USDT', '1d');
    });

    it('checkSlBounds honors sl_include_forming_candle=false vs true', () => {
      // Completed candle high = 105 (5% SL from 100), forming candle wicked to 125 (25% SL > 20% max)
      const candles1d: Candle[] = [
        { time: 1000, open: 100, high: 105, low: 99, close: 101, volume: 100 }, // completed candle
        { time: 2000, open: 101, high: 125, low: 98, close: 100, volume: 100 }, // forming candle
      ];
      const scanner = new MomentumScannerService(
        { getRawCandles: () => candles1d } as any,
        {} as any,
        { resolveInterval: (v: string) => v || '1d' } as any,
      );

      const resCompletedOnly = (scanner as any).checkSlBounds('SOPHUSDT', 100, 'SHORT', {
        sl_type: 'lookback_low/high',
        sl_lookback_timeframe: '1d',
        sl_lookback_period: 1,
        sl_include_forming_candle: false,
        sl_max_pct: 20,
        sl_out_of_bounds_action: 'reject',
        scan_interval: '1d',
      }, candles1d);
      expect(resCompletedOnly.rejected).toBe(false);
      expect(resCompletedOnly.slDistPct).toBeCloseTo(5, 2);

      const resWithForming = (scanner as any).checkSlBounds('SOPHUSDT', 100, 'SHORT', {
        sl_type: 'lookback_low/high',
        sl_lookback_timeframe: '1d',
        sl_lookback_period: 1,
        sl_include_forming_candle: true,
        sl_max_pct: 20,
        sl_out_of_bounds_action: 'reject',
        scan_interval: '1d',
      }, candles1d);
      expect(resWithForming.rejected).toBe(true);
      expect(resWithForming.slDistPct).toBeCloseTo(25, 2);
    });
  });

  describe('ExecutionService candidate-gated 1m warmup healing', () => {
    const buildExec = (checkEntryImpl: jest.Mock, ensureKlinesAvailable: jest.Mock) => {
      return new ExecutionService(
        { getPrice: () => 100, getTicker: () => ({ price: 100, markPrice: 100 }) } as any,
        { getRawCandles: () => [], getLookbackExtremes: () => ({ minLow: 95, maxHigh: 105 }), trimGapsAndStaleTail: jest.fn() } as any,
        { checkEntry: checkEntryImpl } as any,
        {
          computeSl: () => ({ slPrice: 95, rejected: false }),
          computePositionSize: () => ({ qty: 1, riskUsdt: 5, riskPct: 1, rejected: false }),
          computeTp: () => 110,
          canEnter: () => ({ canEnter: true, reason: 'OK' }),
        } as any,
        {
          activeList: () => [],
          hasSymbol: () => false,
          countByStrategy: () => 0,
          enteringCount: () => 0,
          totalRisk: () => 0,
          isEntering: () => false,
          setEntering: jest.fn(),
          add: jest.fn(),
          peakRrSwitchHits: new Map(),
        } as any,
        {
          applyFilters: (_s: string, p: number, q: number) => ({ price: p, qty: q, valid: true }),
          enter: jest.fn().mockResolvedValue({ status: 'SUCCESS', trade: { id: 't-heal', symbol: 'ETHUSDT', qty: 1, entry_price: 100 } }),
        } as any,
        {
          getBalance: () => 1000,
          isBanned: () => false,
          isGeoBlocked: () => false,
          entryInProgress: false,
          realTimePositions: new Map(),
          isPaused: false,
          isStrategyPaused: () => false,
          pausedStrategies: new Set(),
          closedTrades: [],
        } as any,
        { isExecutionAllowed: () => true, getStrategyGateState: () => ({ gateState: 'ACTIVE' }) } as any,
        { broadcast: jest.fn() } as any,
        { setLoopStage: jest.fn() } as any,
        { serializeTrade: jest.fn((t: any) => t) } as any,
        { emit: jest.fn() } as any,
        {} as any,
        {
          resolveInterval: (v: string) => v || '1h',
          queueBackfill: jest.fn(),
          ensureKlinesAvailable,
          getSymbolFilters: () => ({ tickSize: 0.01, stepSize: 0.01, minNotional: 5 }),
        } as any,
      );
    };

    const mtfCfg: Partial<SessionConfig> = {
      strategy_label: 'DynMulti',
      trading_mode: 'paper',
      paper_mode: true,
      scan_interval: '1h',
      entry_side: 'long',
      signal_logic: 'all',
      enabled_signals: ['ema_dual', 'ema_dual_2'],
      signal_timeframes: { ema_dual: '1m', ema_dual_2: '1h' },
      sl_type: 'pct',
      sl_distance_pct: 2,
      risk_pct_per_trade: 1,
      max_total_risk_pct: 5,
      max_open_trades: 3,
    };

    it('skips 1m REST backfill when 1h gate (ema_dual_2) failed', async () => {
      const ensureKlinesAvailable = jest.fn().mockResolvedValue(undefined);
      const checkEntry = jest.fn()
        .mockReturnValueOnce({ allFired: false, firedSignals: [], reason: 'Indicator warm-up in progress (5/18 candles on 1m for ema_dual)' })
        .mockReturnValueOnce({
          allFired: false,
          firedSignals: [], // 1h ema_dual_2 did NOT fire
          reason: 'ema_dual_2 rejected by MACD',
          details: {
            ema_dual: { fired: false, insufficientData: true, timeframe: '1m' },
            ema_dual_2: { fired: false, timeframe: '1h' },
          },
        });

      const exec = buildExec(checkEntry, ensureKlinesAvailable);
      await exec.processEntries([{ symbol: 'ETHUSDT', direction: 'LONG', dir: 'long', price: 100 }], mtfCfg as SessionConfig, 'DynMulti');
      expect(ensureKlinesAvailable).not.toHaveBeenCalled();
    });

    it('heals 1m on demand and enters when non-1m gates pass and only 1m warmup blocked entry', async () => {
      const ensureKlinesAvailable = jest.fn().mockResolvedValue(undefined);
      const checkEntry = jest.fn()
        .mockReturnValueOnce({ allFired: false, firedSignals: [], reason: 'Indicator warm-up in progress (5/18 candles on 1m for ema_dual)' })
        .mockReturnValueOnce({
          allFired: false,
          firedSignals: ['ema_dual_2'], // non-1m 1h gate PASSED
          reason: 'Indicator warm-up in progress (5/18 candles on 1m for ema_dual)',
          details: {
            ema_dual: { fired: false, insufficientData: true, timeframe: '1m' },
            ema_dual_2: { fired: true, timeframe: '1h' },
          },
        })
        .mockReturnValueOnce({ allFired: true, firedSignals: ['ema_dual', 'ema_dual_2'], reason: 'ok' })
        .mockReturnValueOnce({ allFired: true, firedSignals: ['ema_dual', 'ema_dual_2'], details: {}, reason: 'ok' });

      const exec = buildExec(checkEntry, ensureKlinesAvailable);
      await exec.processEntries([{ symbol: 'ETHUSDT', direction: 'LONG', dir: 'long', price: 100 }], mtfCfg as SessionConfig, 'DynMulti');
      expect(ensureKlinesAvailable).toHaveBeenCalledWith('ETHUSDT', '1m', 20);
      expect((exec as any).orderManager.enter).toHaveBeenCalled();
    });
  });
});
