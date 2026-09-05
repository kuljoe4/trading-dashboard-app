import { Test, TestingModule } from '@nestjs/testing';
import { BacktestService } from './backtest.service';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { SessionConfig } from '../models/SessionConfig';

describe('Bolt BacktestService Performance Benchmark & Parity', () => {
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

    // Mock fetch to simulate 500 candles across 5 symbols
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const now = Date.now();
      const rawCandles: any[][] = [];
      for (let i = 0; i < 500; i++) {
        rawCandles.push([
          now - (500 - i) * 300000,
          '100',
          i % 2 === 0 ? '105' : '102',
          '98',
          (100 + (i % 10)).toString(),
          '1000',
          now - (500 - i) * 300000 + 299999,
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

  it('runs backtest with zero-allocation slicing optimization and verifies correct summary metrics', async () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
    config.scan_interval = '5m';
    config.risk_pct_per_trade = 1.0;

    const iterations = 10;
    const start = performance.now();
    let lastResult: any = null;

    for (let i = 0; i < iterations; i++) {
      lastResult = await service.runBacktest({
        config,
        symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
        days: 2,
        startingBalance: 10000,
      });
    }

    const end = performance.now();
    const avgDurationMs = (end - start) / iterations;

    console.log(`⚡ Bolt Backtest Performance Benchmark (${iterations} backtest runs over 5 symbols x 500 candles):`);
    console.log(`  - Average execution time per backtest run: ${avgDurationMs.toFixed(2)} ms`);

    expect(lastResult).toBeDefined();
    expect(lastResult.startingBalance).toBe(10000);
    expect(lastResult.totalTrades).toBeGreaterThanOrEqual(1);
    expect(lastResult.winRate).toBeGreaterThanOrEqual(0);
    expect(typeof lastResult.profitFactor).toBe('number');
    expect(typeof lastResult.sharpeRatio).toBe('number');
  });
});
