import { SmartOptimizerService } from './smart-optimizer.service';
import { SessionConfig } from '../models/SessionConfig';
import { BacktestService } from './backtest.service';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';

describe('SmartOptimizerService Unit Tests', () => {
  let optimizerService: SmartOptimizerService;
  let backtestService: BacktestService;

  beforeEach(() => {
    const mockKlineRepo: any = {};
    const mockEventEmitter: any = {};
    const mockSessionState: any = {};
    const mockSettingsRepo: any = {};

    const klineStore = new KlineStoreService(mockKlineRepo);
    const signalEngine = new SignalEngineService(klineStore);
    const binanceClientFactory = new BinanceClientFactory(mockEventEmitter, mockSessionState, mockSettingsRepo);
    backtestService = new BacktestService(signalEngine, klineStore, binanceClientFactory);
    optimizerService = new SmartOptimizerService(backtestService);
  });

  afterEach(() => {
    optimizerService.clearRecommendations();
  });

  test('generateRandomizedConfig produces valid SessionConfig with auto-generated strategy label', () => {
    const baseConfig = new SessionConfig();
    baseConfig.risk_pct_per_trade = 1.0;

    const { config, name } = optimizerService.generateRandomizedConfig(baseConfig, 0);

    expect(config).toBeInstanceOf(SessionConfig);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
    expect(config.strategy_label).toBe(name);
    expect(config.enabled_signals).toBeDefined();
    expect(Array.isArray(config.enabled_signals)).toBe(true);
    expect(config.enabled_signals!.length).toBeGreaterThan(0);
    expect(config.sl_distance_pct).toBeGreaterThan(0);
    expect(config.tp_ratio).toBeGreaterThan(0);
  });

  test('maintains top in-memory recommendations ranked by composite score', async () => {
    // Mock runBacktest to return predictable performance metrics
    jest.spyOn(backtestService, 'runBacktest').mockImplementation(async (dto) => {
      const isSuper = dto.config?.enabled_signals?.includes('supertrend');
      return {
        totalTrades: isSuper ? 10 : 5,
        wins: isSuper ? 7 : 2,
        losses: isSuper ? 3 : 3,
        winRate: isSuper ? 70 : 40,
        totalPnl: isSuper ? 350 : 50,
        pnlPct: isSuper ? 3.5 : 0.5,
        profitFactor: isSuper ? 2.5 : 1.1,
        maxDrawdown: 100,
        maxDrawdownPct: isSuper ? 1.5 : 4.0,
        sharpeRatio: isSuper ? 1.8 : 0.4,
        expectancy: isSuper ? 35 : 10,
        avgTradePnl: isSuper ? 35 : 10,
        avgWin: 60,
        avgLoss: 25,
        startingBalance: 10000,
        endingBalance: isSuper ? 10350 : 10050,
        totalFees: 12,
        executionTimeMs: 15,
        config: dto.config || new SessionConfig(),
        equityCurve: [],
        trades: [],
      };
    });

    const result = await optimizerService.runOptimization({
      iterations: 5,
      days: 7,
      startingBalance: 10000,
      symbols: ['BTCUSDT'],
      topCount: 3,
    });

    expect(result.testedCount).toBe(5);
    expect(result.topRecommendations.length).toBeGreaterThan(0);

    const recs = optimizerService.getTopRecommendations();
    expect(recs.length).toBe(result.topRecommendations.length);

    // Verify ranks 1..N
    for (let i = 0; i < recs.length; i++) {
      expect(recs[i].rank).toBe(i + 1);
      if (i > 0) {
        expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
      }
    }
  });

  test('clearRecommendations resets in-memory store', async () => {
    jest.spyOn(backtestService, 'runBacktest').mockImplementation(async (dto) => ({
      totalTrades: 5,
      wins: 3,
      losses: 2,
      winRate: 60,
      totalPnl: 150,
      pnlPct: 1.5,
      profitFactor: 1.8,
      maxDrawdown: 50,
      maxDrawdownPct: 1.0,
      sharpeRatio: 1.2,
      expectancy: 30,
      avgTradePnl: 30,
      avgWin: 60,
      avgLoss: 30,
      startingBalance: 10000,
      endingBalance: 10150,
      totalFees: 5,
      executionTimeMs: 10,
      config: dto.config || new SessionConfig(),
      equityCurve: [],
      trades: [],
    }));

    await optimizerService.runOptimization({ iterations: 2 });
    expect(optimizerService.getTopRecommendations().length).toBeGreaterThan(0);

    optimizerService.clearRecommendations();
    expect(optimizerService.getTopRecommendations().length).toBe(0);
  });
});
