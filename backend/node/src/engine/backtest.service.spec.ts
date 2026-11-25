import { SessionController } from '../trading/session.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BacktestService, RunBacktestDto } from './backtest.service';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { SessionConfig } from '../models/SessionConfig';

describe('BacktestService', () => {
  let service: BacktestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestService,
        {
          provide: SignalEngineService,
          useValue: {
            getRequiredWarmup: jest.fn().mockReturnValue(5),
            checkEntry: jest.fn().mockImplementation((symbol, config, interval, side, purpose) => {
              if (purpose === 'entry') {
                return { allFired: true, firedSignals: ['momentum_pct'], reason: 'Triggered' };
              }
              return { allFired: false, firedSignals: [], reason: 'No exit' };
            }),
          },
        },
        {
          provide: KlineStoreService,
          useValue: {
            candlesMap: new Map(),
            getRawCandles: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: BinanceClientFactory,
          useValue: {
            genericRequest: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BacktestService>(BacktestService);

    // Mock fetch for historical candles
    global.fetch = jest.fn().mockImplementation(async () => {
      const now = Date.now();
      const rawCandles: any[][] = [];
      for (let i = 0; i < 20; i++) {
        rawCandles.push([
          now - (20 - i) * 300000,
          '100',
          i % 2 === 0 ? '105' : '102',
          '98',
          (100 + i).toString(),
          '1000',
          now - (20 - i) * 300000 + 299999,
        ]);
      }
      return {
        ok: true,
        json: async () => rawCandles,
      };
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should run backtest successfully over historical candles and compute performance metrics', async () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT'];
    config.scan_interval = '5m';
    config.risk_pct_per_trade = 1.0;

    const result = await service.runBacktest({
      config,
      symbols: ['BTCUSDT'],
      days: 1,
      startingBalance: 10000,
    });

    expect(result).toBeDefined();
    expect(result.startingBalance).toBe(10000);
    expect(result.totalTrades).toBeGreaterThanOrEqual(1);
    expect(result.equityCurve).toBeDefined();
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.totalFees).toBeGreaterThanOrEqual(0);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should filter out non-USDT symbols safely', async () => {
    const config = new SessionConfig();
    const result = await service.runBacktest({
      config,
      symbols: ['BTCUSDC', 'ETHUSDT'],
      days: 1,
      startingBalance: 5000,
    });

    expect(result).toBeDefined();
    expect(result.startingBalance).toBe(5000);
  });

  it('should throw BadRequestException if no historical candle data could be retrieved', async () => {
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
    })) as any;

    const config = new SessionConfig();
    await expect(
      service.runBacktest({
        config,
        symbols: ['INVALIDPAIR'],
        days: 1,
      })
    ).rejects.toThrow();
  });

  describe('RunBacktestDto Security Schema Validation', () => {
    it('should validate valid RunBacktestDto payloads successfully', async () => {
      const dto = plainToInstance(RunBacktestDto, {
        symbols: ['BTCUSDT', 'ETHUSDT'],
        days: 7,
        startingBalance: 10000,
        useGlobalScanner: true,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject symbol arrays exceeding 50 items to prevent DoS', async () => {
      const hugeSymbols = Array.from({ length: 51 }, (_, i) => `SYM${i}USDT`);
      const dto = plainToInstance(RunBacktestDto, {
        symbols: hugeSymbols,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.property === 'symbols')).toBe(true);
    });

    it('should reject malformed symbols containing script injection or invalid characters', async () => {
      const dto = plainToInstance(RunBacktestDto, {
        symbols: ['<script>alert(1)</script>', 'BTCUSDT;DROP TABLE trades;'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.property === 'symbols')).toBe(true);
    });

    it('should reject startingBalance exceeding max upper bound', async () => {
      const dto = plainToInstance(RunBacktestDto, {
        startingBalance: 9999999999,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.property === 'startingBalance')).toBe(true);
    });

    it('should accept extended 365/730 day horizons and 1d scanInterval', async () => {
      const dto = plainToInstance(RunBacktestDto, {
        symbols: ['BTCUSDT'],
        days: 365,
        scanInterval: '1d',
        startingBalance: 10000,
        useGlobalScanner: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('End-to-End Solo Symbol & Multi-Timeframe Parity (Real SignalEngineService)', () => {
    let realService: BacktestService;
    let realSignalEngine: SignalEngineService;
    let proxyFetchMock: jest.Mock;

    const buildWaveKlines = (
      count: number,
      intervalMs: number,
      startTs: number,
      wavePeriodBars: number,
      amplitude = 18,
    ): any[][] => {
      const rows: any[][] = [];
      for (let i = 0; i < count; i++) {
        const openTime = startTs + i * intervalMs;
        const close = 100 + Math.sin((i / wavePeriodBars) * Math.PI * 2) * amplitude + i * 0.05;
        const prevClose = i === 0 ? close : 100 + Math.sin(((i - 1) / wavePeriodBars) * Math.PI * 2) * amplitude + (i - 1) * 0.05;
        const high = Math.max(openTime ? prevClose : close, close) * 1.008;
        const low = Math.min(prevClose, close) * 0.992;
        rows.push([
          openTime,
          prevClose.toFixed(4),
          high.toFixed(4),
          low.toFixed(4),
          close.toFixed(4),
          '1500',
          openTime + intervalMs - 1,
        ]);
      }
      return rows;
    };

    beforeEach(async () => {
      proxyFetchMock = jest.fn();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BacktestService,
          SignalEngineService,
          {
            provide: KlineStoreService,
            useValue: {
              candlesMap: new Map(),
              getRawCandles: jest.fn().mockReturnValue([]),
            },
          },
          {
            provide: BinanceClientFactory,
            useValue: {
              genericRequest: jest.fn(),
              proxyFetch: proxyFetchMock,
            },
          },
        ],
      }).compile();

      realService = module.get<BacktestService>(BacktestService);
      realSignalEngine = module.get<SignalEngineService>(SignalEngineService);
    });

    it.each([false, true])('replays real momentum entries with scanner enabled=%s', async (useGlobalScanner) => {
      const barMs = 5 * 60 * 1000;
      const klines = buildWaveKlines(340, barMs, Date.UTC(2024, 0, 1), 32);
      proxyFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => klines });

      const config = Object.assign(new SessionConfig(), {
        symbols: ['BTCUSDT'],
        scan_interval: '5m',
        scan_lookback: 3,
        scan_pct_threshold: 2,
        enabled_signals: ['momentum_pct'],
        entry_side: 'long',
        sl_type: 'pct',
        sl_distance_pct: 3,
        tp_mode: 'fixed',
        tp_ratio: 2,
      });

      const controller = new SessionController(null as any, realService, null as any);
      const result = await controller.runBacktest({
        config, useGlobalScanner, days: 1, startingBalance: 10000,
      });

      expect(proxyFetchMock).toHaveBeenCalled();
      expect(result.symbolPerformance.map(row => row.symbol)).toEqual(['BTCUSDT']);
      expect(result.totalTrades).toBeGreaterThan(0);
      expect(result.trades.every(trade => trade.direction === 'LONG' && trade.exit_ts >= trade.entry_ts)).toBe(true);
    });

    it('runs solo-symbol ema_dual_cross on 1d over 365 days via single_symbol_configs and isolates live caches', async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const startTs = Date.UTC(2024, 0, 1);
      const dailyKlines = buildWaveKlines(430, dayMs, startTs, 32, 22);

      proxyFetchMock.mockImplementation(async (url: string) => {
        expect(url).toContain('symbol=BTCUSDT');
        expect(url).toContain('interval=1d');
        return { ok: true, status: 200, json: async () => dailyKlines };
      });

      const config = new SessionConfig();
      config.symbols = [];
      config.single_symbol_configs = [{ symbol: 'BTCUSDT', enabled: true, follow_schedule: true, use_custom_config: false }];
      config.global_scanner_enabled = false;
      config.scan_interval = '1d';
      config.enabled_signals = ['ema_dual_cross'];
      config.exit_signals = ['ema_dual_cross'];
      config.signal_params = { entry_ema_fast: 5, entry_ema_slow: 12, exit_ema_fast: 5, exit_ema_slow: 12 };
      config.sl_type = 'pct';
      config.sl_distance_pct = 5.0;
      config.tp_mode = 'fixed';
      config.tp_ratio = 2.0;
      config.risk_pct_per_trade = 1.0;

      const result = await realService.runBacktest({
        config,
        days: 365,
        startingBalance: 10000,
      });

      expect(proxyFetchMock).toHaveBeenCalled();
      expect(result.symbolPerformance.map(s => s.symbol)).toEqual(['BTCUSDT']);
      expect(result.totalTrades).toBeGreaterThanOrEqual(2);

      // Verify backtest cleaned up all __bt__: cache entries
      const emaCacheKeys = Array.from((realSignalEngine as any).emaCache.keys()) as string[];
      const emaDualKeys = Array.from((realSignalEngine as any).emaDualCache.keys()) as string[];
      const stableKeys = Array.from((realSignalEngine as any).emaStableCache.keys()) as string[];
      expect(emaCacheKeys.some(k => k.startsWith('__bt__:'))).toBe(false);
      expect(emaDualKeys.some(k => k.startsWith('__bt__:'))).toBe(false);
      expect(stableKeys.some(k => k.startsWith('__bt__:'))).toBe(false);
    });

    it('runs solo-symbol macd_impulse with EMA cross on 1h and honors multi-timeframe signal_timeframes', async () => {
      const hourMs = 60 * 60 * 1000;
      const fourHourMs = 4 * hourMs;
      const startTs = Date.UTC(2025, 0, 1);

      // Macro uptrend with 24h pullback waves so 4h EMA(5)>EMA(12) stays bullish while 1h MACD impulse fires on pullback bounces
      const hourlyKlines: any[][] = [];
      let prevClose = 100;
      for (let i = 0; i < 420; i++) {
        const ts = startTs + i * hourMs;
        const close = 100 + i * 0.18 + Math.sin((i * 2 * Math.PI) / 24) * 5;
        const open = prevClose;
        const high = Math.max(open, close) * 1.004;
        const low = Math.min(open, close) * 0.996;
        hourlyKlines.push([ts, String(open), String(high), String(low), String(close), '250', ts + hourMs - 1]);
        prevClose = close;
      }

      // Aggregate matching 4h candles directly from the 1h series
      const fourHourKlines: any[][] = [];
      for (let i = 0; i < hourlyKlines.length; i += 4) {
        const group = hourlyKlines.slice(i, i + 4);
        if (group.length < 4) break;
        const ts = group[0][0];
        const open = group[0][1];
        const high = String(Math.max(...group.map(g => parseFloat(g[2]))));
        const low = String(Math.min(...group.map(g => parseFloat(g[3]))));
        const close = group[group.length - 1][4];
        fourHourKlines.push([ts, open, high, low, close, '1000', ts + fourHourMs - 1]);
      }

      const requestedIntervals = new Set<string>();
      proxyFetchMock.mockImplementation(async (url: string) => {
        const match = url.match(/interval=([^&]+)/);
        const tf = match ? match[1] : '1h';
        requestedIntervals.add(tf);
        return {
          ok: true,
          status: 200,
          json: async () => (tf === '4h' ? fourHourKlines : hourlyKlines),
        };
      });

      const config = new SessionConfig();
      config.symbols = ['ETHUSDT'];
      config.global_scanner_enabled = false;
      config.scan_interval = '1h';
      config.enabled_signals = ['macd_impulse', 'ema_dual'];
      config.signal_logic = 'all';
      config.signal_timeframes = {
        macd_impulse: '1h',
        ema_dual: '4h',
      };
      config.signal_params = {
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_strict_expansion: false,
        macd_impulse_max_entry_candle: 2,
        entry_ema_fast: 5,
        entry_ema_slow: 12,
      };
      config.sl_type = 'pct';
      config.sl_distance_pct = 2.0;
      config.tp_mode = 'fixed';
      config.tp_ratio = 1.5;

      const result = await realService.runBacktest({
        config,
        symbols: ['ETHUSDT'],
        days: 10,
        startingBalance: 10000,
        useGlobalScanner: false,
      });

      expect(requestedIntervals.has('1h')).toBe(true);
      expect(requestedIntervals.has('4h')).toBe(true);
      expect(result.symbolPerformance.map(s => s.symbol)).toEqual(['ETHUSDT']);
      expect(result.totalTrades).toBeGreaterThanOrEqual(1);
    });

    it('surfaces HTTP 451 geo-restriction errors clearly when proxyFetch returns 451', async () => {
      proxyFetchMock.mockResolvedValue({
        ok: false,
        status: 451,
      });

      const config = new SessionConfig();
      config.scan_interval = '1d';
      config.enabled_signals = ['ema_dual_cross'];

      await expect(
        realService.runBacktest({
          config,
          symbols: ['BTCUSDT'],
          days: 90,
          useGlobalScanner: false,
        })
      ).rejects.toThrow(/HTTP 451.*Geo-Restriction/i);
    });
  });
});
