import { MomentumScannerService } from './momentum_scanner.service';
import { ExecutionService } from './execution.service';
import { TradingSessionService } from './trading_session.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { ENGINE_EVENTS } from './events';

describe('Candidate Skip & Removal Logging', () => {
  describe('MomentumScannerService pre-filter reason tracking', () => {
    it('records momentum_below / sl_bounds reasons and clears them when symbol passes', () => {
      const candles = Array.from({ length: 20 }, (_, idx) => ({
        time: idx * 60000,
        open: 100,
        high: 101,
        low: 99,
        close: idx === 19 ? 100.5 : 100,
        volume: 1000,
      }));
      const klineStore = {
        getRawCandles: jest.fn().mockReturnValue(candles),
      } as any;
      const tickerCache = {
        getPrice: jest.fn().mockReturnValue(null),
        getTicker: jest.fn().mockReturnValue({ price: 100.5, volume_24h: 1_000_000 }),
        topByVolume: jest.fn().mockReturnValue([]),
      } as any;
      const marketFeed = {
        getSymbolFilters: jest.fn().mockReturnValue({ filters: [] }),
        resolveInterval: jest.fn().mockImplementation((v) => v || '5m'),
      } as any;

      const scanner = new MomentumScannerService(klineStore, tickerCache, marketFeed);

      // Move is +0.50% which is below 2.0% threshold for dynamic symbol
      const resFail = (scanner as any).scanSymbol('ENAUSDT', '5m', {
        scan_pct_threshold: 2.0,
        scan_lookback: 3,
      }, false);
      expect(resFail).toBeNull();

      const recorded = scanner.getPreFilterReason('ENAUSDT');
      expect(recorded).toBeTruthy();
      expect(recorded?.code).toBe('momentum_below');
      expect(recorded?.reason).toContain('0.50%');

      // Now price crosses threshold -> passes and clears recorded pre-filter reason
      candles[19].close = 103.5;
      const resPass = (scanner as any).scanSymbol('ENAUSDT', '5m', {
        scan_pct_threshold: 2.0,
        scan_lookback: 3,
      }, false);
      expect(resPass).not.toBeNull();
      expect(scanner.getPreFilterReason('ENAUSDT')).toBeFalsy();
    });
  });

  describe('ExecutionService deduped [Decision] skip emission', () => {
    it('emits ENGINE_EVENTS.LOG_MESSAGE with strategy attribution and dedupes within cooldown', async () => {
      const eventEmitter = { emit: jest.fn() } as any;
      const exec = new ExecutionService(
        {
          getPrice: () => 0.1426,
          getTicker: () => ({ price: 0.1426, markPrice: 0.1426 }),
        } as any, // 1. tickerCache
        {
          getRawCandles: () => [],
          getLookbackExtremes: () => ({ minLow: 0.105, maxHigh: 0.16, reason: null }),
        } as any, // 2. klineStore
        {
          checkEntry: () => ({ allFired: true, details: {}, reason: '' }),
        } as any, // 3. signalEngine
        {
          computeSl: jest.fn().mockReturnValue({
            slPrice: 0.105,
            rejected: true,
            reason: 'Lookback SL dist 26.08% above max 20%',
          }),
        } as any, // 4. riskEngine
        {
          activeList: () => [],
          hasSymbol: () => false,
          countByStrategy: () => 0,
          peakRrSwitchHits: new Map(),
        } as any, // 5. positionTracker
        {} as any, // 6. orderManager
        {
          getBalance: () => 10000,
          isBanned: () => false,
          isGeoBlocked: () => false,
          entryInProgress: false,
          realTimePositions: new Map(),
          isPaused: false,
          isStrategyPaused: () => false,
          pausedStrategies: new Set(),
          closedTrades: [],
        } as any, // 7. sessionState
        {
          isExecutionAllowed: () => true,
          getStrategyGateState: () => ({ gateState: 'ACTIVE' }),
        } as any, // 8. gatingService
        { broadcast: jest.fn() } as any, // 9. broadcastService
        { setLoopStage: jest.fn() } as any, // 10. monitoringService
        {} as any, // 11. engineBroadcaster
        eventEmitter, // 12. eventEmitter
        {} as any, // 13. analyticsService
        {
          resolveInterval: (v: string) => v || '5m',
          queueBackfill: jest.fn(),
          getSymbolFilters: () => null,
        } as any, // 14. marketFeedService
      );

      const opp: any = {
        symbol: 'ENAUSDT',
        direction: 'LONG',
        dir: 'long',
        pct: 3.2,
        price: 0.1426,
        strategy_label: 'Swing Breakout',
        signalResult: { allFired: true, firedSignals: ['ema_dual'] },
      };
      const cfg: any = {
        strategy_label: 'Swing Breakout',
        scan_interval: '5m',
        entry_side: 'both',
        sl_type: 'lookback_low/high',
        sl_max_pct: 20,
      };

      await exec.processEntries([opp], cfg, 'Swing Breakout', async () => {});
      await exec.processEntries([opp], cfg, 'Swing Breakout', async () => {});

      const decisionLogs = eventEmitter.emit.mock.calls.filter(
        ([evt, payload]: any[]) => evt === ENGINE_EVENTS.LOG_MESSAGE && payload?.msg?.includes('[Decision] ENAUSDT (Swing Breakout): Entry skipped')
      );
      expect(decisionLogs.length).toBe(1);
      expect(decisionLogs[0][1].level).toBe('warn');
      expect(decisionLogs[0][1].msg).toContain('26.08%');
    });
  });

  describe('TradingSessionService near-target candidate drop logging', () => {
    it('logs [Scanner] Candidate removed when a near-target candidate vanishes without entering a position', () => {
      const eventEmitter = { emit: jest.fn() } as any;
      const momentumScanner = {
        getPreFilterReason: jest.fn().mockReturnValue({
          code: 'sl_bounds',
          reason: 'SL dist 22.10% > max 20% (REJECT)',
          ts: Date.now(),
        }),
      } as any;
      const variantAnalytics = new VariantAnalyticsService();
      const positionTracker = {
        activeList: () => [],
        activeCount: () => 0,
        totalRisk: () => 0,
        recalculateTotalRisk: jest.fn(),
        clear: jest.fn(),
      } as any;
      const engineBroadcaster = new EngineBroadcasterService(
        {} as any, {} as any, {} as any, {} as any, {} as any, variantAnalytics, {} as any, positionTracker
      );

      const session = new TradingSessionService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        positionTracker,
        {} as any,
        {} as any,
        momentumScanner,
        { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any,
        { reset: jest.fn(), getBalance: () => 10000, closedTrades: [], isStrategyPaused: () => false } as any,
        variantAnalytics,
        engineBroadcaster,
        {} as any,
        {} as any,
        { log: jest.fn() } as any,
        eventEmitter,
      );

      const strategyConfigs: any[] = [{
        strategy_label: 'Base Momentum',
        scan_pct_threshold: 2.0,
      }];

      // Scan tick 1: SUIUSDT is near target (85% of threshold with 1 signal fired)
      (session as any).trackAndLogRemovedCandidates(
        strategyConfigs,
        [{
          strategy_label: 'Base Momentum',
          opportunities: [{
            symbol: 'SUIUSDT',
            pct: 1.85,
            dir: 'long',
            score: 82,
            signalResult: { allFired: false, firedSignals: ['ema_dual'] },
          }],
        }],
        new Set(),
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();

      // Scan tick 2: SUIUSDT disappears and was not promoted to an active position
      (session as any).trackAndLogRemovedCandidates(
        strategyConfigs,
        [{ strategy_label: 'Base Momentum', opportunities: [] }],
        new Set(),
      );

      const dropCalls = eventEmitter.emit.mock.calls.filter(
        ([evt, payload]: any[]) => evt === ENGINE_EVENTS.LOG_MESSAGE && payload?.msg?.includes('[Scanner] SUIUSDT (Base Momentum): Candidate removed')
      );
      expect(dropCalls.length).toBe(1);
      expect(dropCalls[0][1].msg).toContain('SL dist 22.10% > max 20%');
    });
  });
});
