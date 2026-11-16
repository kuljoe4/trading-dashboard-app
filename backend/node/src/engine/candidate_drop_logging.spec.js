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
            };
            const tickerCache = {
                getTicker: jest.fn().mockReturnValue({ price: 100.5, volume_24h: 1_000_000 }),
                topByVolume: jest.fn().mockReturnValue([]),
            };
            const marketFeed = {
                getSymbolFilters: jest.fn().mockReturnValue({ filters: [] }),
                resolveInterval: jest.fn().mockImplementation((v) => v || '5m'),
            };
            const scanner = new MomentumScannerService(klineStore, tickerCache, marketFeed);
            // Move is +0.50% which is below 2.0% threshold for dynamic symbol
            const resFail = scanner.scanSymbol('ENAUSDT', '5m', {
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
            const resPass = scanner.scanSymbol('ENAUSDT', '5m', {
                scan_pct_threshold: 2.0,
                scan_lookback: 3,
            }, false);
            expect(resPass).not.toBeNull();
            expect(scanner.getPreFilterReason('ENAUSDT')).toBeFalsy();
        });
    });
    describe('ExecutionService deduped [Decision] skip emission', () => {
        it('emits ENGINE_EVENTS.LOG_MESSAGE with strategy attribution and dedupes within cooldown', async () => {
            const eventEmitter = { emit: jest.fn() };
            const exec = new ExecutionService({
                getPrice: () => 0.1426,
                getTicker: () => ({ price: 0.1426, markPrice: 0.1426 }),
            }, // 1. tickerCache
            {
                getRawCandles: () => [],
                getLookbackExtremes: () => ({ minLow: 0.105, maxHigh: 0.16, reason: null }),
            }, // 2. klineStore
            {
                checkEntry: () => ({ allFired: true, details: {}, reason: '' }),
            }, // 3. signalEngine
            {
                computeSl: jest.fn().mockReturnValue({
                    slPrice: 0.105,
                    rejected: true,
                    reason: 'Lookback SL dist 26.08% above max 20%',
                }),
            }, // 4. riskEngine
            {
                activeList: () => [],
                hasSymbol: () => false,
                countByStrategy: () => 0,
                peakRrSwitchHits: new Map(),
            }, // 5. positionTracker
            {}, // 6. orderManager
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
            }, // 7. sessionState
            {
                isExecutionAllowed: () => true,
                getStrategyGateState: () => ({ gateState: 'ACTIVE' }),
            }, // 8. gatingService
            { broadcast: jest.fn() }, // 9. broadcastService
            { setLoopStage: jest.fn() }, // 10. monitoringService
            {}, // 11. engineBroadcaster
            eventEmitter, // 12. eventEmitter
            {}, // 13. analyticsService
            {
                resolveInterval: (v) => v || '5m',
                queueBackfill: jest.fn(),
                getSymbolFilters: () => null,
            });
            const opp = {
                symbol: 'ENAUSDT',
                direction: 'LONG',
                dir: 'long',
                pct: 3.2,
                price: 0.1426,
                strategy_label: 'Swing Breakout',
                signalResult: { allFired: true, firedSignals: ['ema_dual'] },
            };
            const cfg = {
                strategy_label: 'Swing Breakout',
                scan_interval: '5m',
                entry_side: 'both',
                sl_type: 'lookback_low/high',
                sl_max_pct: 20,
            };
            await exec.processEntries([opp], cfg, 'Swing Breakout', async () => { });
            await exec.processEntries([opp], cfg, 'Swing Breakout', async () => { });
            const decisionLogs = eventEmitter.emit.mock.calls.filter(([evt, payload]) => evt === ENGINE_EVENTS.LOG_MESSAGE && payload?.msg?.includes('[Decision] ENAUSDT (Swing Breakout): Entry skipped'));
            expect(decisionLogs.length).toBe(1);
            expect(decisionLogs[0][1].level).toBe('warn');
            expect(decisionLogs[0][1].msg).toContain('26.08%');
        });
    });
    describe('TradingSessionService near-target candidate drop logging', () => {
        it('logs [Scanner] Candidate removed when a near-target candidate vanishes without entering a position', () => {
            const eventEmitter = { emit: jest.fn() };
            const momentumScanner = {
                getPreFilterReason: jest.fn().mockReturnValue({
                    code: 'sl_bounds',
                    reason: 'SL dist 22.10% > max 20% (REJECT)',
                    ts: Date.now(),
                }),
            };
            const variantAnalytics = new VariantAnalyticsService();
            const positionTracker = {
                activeList: () => [],
                activeCount: () => 0,
                totalRisk: () => 0,
                recalculateTotalRisk: jest.fn(),
                clear: jest.fn(),
            };
            const engineBroadcaster = new EngineBroadcasterService({}, {}, {}, {}, {}, variantAnalytics, {}, positionTracker);
            const session = new TradingSessionService({}, {}, {}, {}, positionTracker, {}, {}, momentumScanner, { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() }, {}, {}, {}, { setWsBroadcaster: jest.fn(), broadcast: jest.fn() }, { reset: jest.fn(), getBalance: () => 10000, closedTrades: [], isStrategyPaused: () => false }, variantAnalytics, engineBroadcaster, {}, {}, { log: jest.fn() }, eventEmitter);
            const strategyConfigs = [{
                    strategy_label: 'Base Momentum',
                    scan_pct_threshold: 2.0,
                }];
            // Scan tick 1: SUIUSDT is near target (85% of threshold with 1 signal fired)
            session.trackAndLogRemovedCandidates(strategyConfigs, [{
                    strategy_label: 'Base Momentum',
                    opportunities: [{
                            symbol: 'SUIUSDT',
                            pct: 1.85,
                            dir: 'long',
                            score: 82,
                            signalResult: { allFired: false, firedSignals: ['ema_dual'] },
                        }],
                }], new Set());
            expect(eventEmitter.emit).not.toHaveBeenCalled();
            // Scan tick 2: SUIUSDT disappears and was not promoted to an active position
            session.trackAndLogRemovedCandidates(strategyConfigs, [{ strategy_label: 'Base Momentum', opportunities: [] }], new Set());
            const dropCalls = eventEmitter.emit.mock.calls.filter(([evt, payload]) => evt === ENGINE_EVENTS.LOG_MESSAGE && payload?.msg?.includes('[Scanner] SUIUSDT (Base Momentum): Candidate removed'));
            expect(dropCalls.length).toBe(1);
            expect(dropCalls[0][1].msg).toContain('SL dist 22.10% > max 20%');
        });
    });
});
