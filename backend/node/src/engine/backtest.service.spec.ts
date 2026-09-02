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
  let signalEngine: SignalEngineService;
  let klineStore: KlineStoreService;

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
    signalEngine = module.get<SignalEngineService>(SignalEngineService);
    klineStore = module.get<KlineStoreService>(KlineStoreService);

    // Mock fetch for historical candles
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
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
  });
});
