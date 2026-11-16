jest.mock('@nestjs/typeorm', () => ({
    InjectRepository: () => () => { },
    getRepositoryToken: (e) => e?.name || String(e),
}));
import { KlineStoreService } from './kline_store.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { OrderManagerService } from './orderManager';
import { scannerResultsFingerprint, scannerVariantsFingerprint } from './scanner-fingerprint';
import { SignalEngineService } from './signalEngine';
import { SessionConfig } from '../models/SessionConfig';
describe('Condition Widgets Live Update & Broadcast Fidelity (Railway Host)', () => {
    describe('1. KlineStoreService.syncLivePrice', () => {
        let klineStore;
        beforeEach(() => {
            klineStore = new KlineStoreService({});
        });
        it('updates forming candle close, high, and low across cached intervals from live ticker price', async () => {
            await klineStore.upsertCandle('BTCUSDT', '1m', {
                t: 1000,
                o: '100',
                h: '102',
                l: '99',
                c: '101',
                q: '50000',
            });
            await klineStore.upsertCandle('BTCUSDT', '5m', {
                t: 1000,
                o: '100',
                h: '102',
                l: '99',
                c: '101',
                q: '50000',
            });
            klineStore.syncLivePrice('BTCUSDT', 105.5);
            const candles1m = klineStore.getRawCandles('BTCUSDT', '1m');
            expect(candles1m[candles1m.length - 1].close).toBe(105.5);
            expect(candles1m[candles1m.length - 1].high).toBe(105.5);
            expect(candles1m[candles1m.length - 1].low).toBe(99);
            klineStore.syncLivePrice('BTCUSDT', 97.25);
            expect(candles1m[candles1m.length - 1].close).toBe(97.25);
            expect(candles1m[candles1m.length - 1].high).toBe(105.5);
            expect(candles1m[candles1m.length - 1].low).toBe(97.25);
        });
    });
    describe('2. EngineBroadcasterService mid-fidelity & _sig_json freshness', () => {
        let broadcaster;
        let mockSessionState;
        let mockBroadcastService;
        beforeEach(() => {
            mockSessionState = {
                listenerCount: 1,
                closedTrades: [],
                getBalance: jest.fn().mockReturnValue(1000),
                stats: { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 },
            };
            mockBroadcastService = { broadcast: jest.fn() };
            broadcaster = new EngineBroadcasterService({ getPrice: jest.fn().mockReturnValue(102) }, { activeList: jest.fn().mockReturnValue([]), totalRisk: jest.fn().mockReturnValue(0) }, { canEnter: jest.fn().mockReturnValue({ canEnter: true }) }, { calculateAnalytics: jest.fn().mockReturnValue(null) }, { calculateVariantStats: jest.fn().mockReturnValue({}) }, { getSummary: jest.fn().mockReturnValue({}) }, mockBroadcastService, mockSessionState);
        });
        it('preserves _sig_json and exit_signals_status for StrategyDetailView (mid-fidelity) while stripping for Dashboard (low-fidelity)', () => {
            const config = new SessionConfig();
            const trade = {
                id: 't1',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                entry_price: 100,
                qty: 1,
                current_sl: 95,
                initial_sl: 95,
                strategy_label: 'Momentum Strategy',
                exit_signals_status: {
                    rsi_overbought: {
                        fired: false,
                        active: true,
                        value: 64.2,
                        threshold: 70,
                        live_price: 102,
                    },
                },
            };
            const serialized = broadcaster.serializeTickTrade(trade, config, 102, 2, 0.4);
            expect(JSON.parse(serialized._sig_json).rsi_overbought.value).toBe(64.2);
            expect(JSON.parse(serialized._sig_json).rsi_overbought.live_price).toBe(102);
            const rawTick = { type: 'tick', trades: [serialized] };
            // StrategyDetailView client (mid-fidelity)
            const strategyClient = {
                focusMode: true,
                focusStrategyLabel: 'Momentum Strategy',
                focusTradeId: null,
            };
            const midTick = broadcaster.getFidelityTick(rawTick, strategyClient);
            expect(midTick.trades[0]._sig_json).toBeDefined();
            expect(JSON.parse(midTick.trades[0]._sig_json).rsi_overbought.value).toBe(64.2);
            // Dashboard client (low-fidelity)
            const lowClient = { focusMode: false };
            const lowTick = broadcaster.getFidelityTick(rawTick, lowClient);
            expect(lowTick.trades[0]._sig_json).toBeUndefined();
        });
        it('re-serializes _sig_json when exit_signals_status changes on subsequent ticks', () => {
            const config = new SessionConfig();
            const trade = {
                id: 't1',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                entry_price: 100,
                qty: 1,
                current_sl: 95,
                initial_sl: 95,
                strategy_label: 'Momentum Strategy',
                _sig_json: JSON.stringify({ rsi_overbought: { value: 50, threshold: 70 } }),
                exit_signals_status: {
                    rsi_overbought: { value: 68.5, threshold: 70, live_price: 104 },
                },
            };
            const serialized = broadcaster.serializeTickTrade(trade, config, 104, 4, 0.8);
            expect(JSON.parse(serialized._sig_json).rsi_overbought.value).toBe(68.5);
        });
    });
    describe('3. OrderManagerService.checkExitSignals rich detail preservation', () => {
        it('retains live_price, closed_value, ref_high, ref_low, prevFast, prevSlow on exit_signals_status', () => {
            const mockSignalEngine = {
                getRequiredWarmup: jest.fn().mockReturnValue(10),
                checkEntry: jest.fn().mockReturnValue({
                    allFired: false,
                    firedSignals: [],
                    details: {
                        htf_breakout: {
                            fired: false,
                            metric: 'HTF Breakout',
                            value: 101.5,
                            threshold: 102.0,
                            unit: 'price',
                            description: 'Breakout check',
                            threshold_is_price: true,
                            live_price: 101.5,
                            closed_value: 101.1,
                            ref_high: 102.0,
                            ref_low: 98.5,
                            evaluated_at_ms: 123456789,
                        },
                    },
                }),
            };
            const mockKlineStore = {
                getRawCandles: jest.fn().mockReturnValue(new Array(20).fill({ time: 1000, close: 101.5 })),
            };
            const orderManager = new OrderManagerService(mockSignalEngine, {}, { getPrice: jest.fn().mockReturnValue(101.5) }, {}, {}, {}, {}, {}, {}, {}, {}, undefined, mockKlineStore);
            const trade = {
                id: 't1',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                entry_price: 100,
                qty: 1,
                entry_ts: new Date(Date.now() - 60000),
            };
            const config = Object.assign(new SessionConfig(), {
                use_exit_signals: true,
                exit_signals: ['htf_breakout'],
                exit_signal_logic: 'ANY',
            });
            orderManager.checkExitSignals('BTCUSDT', trade, config, '5m');
            expect(trade.exit_signals_status).toBeDefined();
            expect(trade.exit_signals_status.htf_breakout.live_price).toBe(101.5);
            expect(trade.exit_signals_status.htf_breakout.closed_value).toBe(101.1);
            expect(trade.exit_signals_status.htf_breakout.ref_high).toBe(102.0);
            expect(trade.exit_signals_status.htf_breakout.ref_low).toBe(98.5);
            expect(trade.exit_signals_status.htf_breakout.evaluated_at_ms).toBe(123456789);
        });
    });
    describe('4. Scanner & Variant Fingerprinting', () => {
        it('detects changes in variant condition values and live_price', () => {
            const base = [{
                    symbol: 'BTCUSDT',
                    direction: 'LONG',
                    score: 80,
                    price: 100,
                    pct: 1.5,
                    signalResult: {
                        allFired: false,
                        firedSignals: [],
                        details: { rsi: { value: 55, threshold: 70, live_price: 100 } },
                    },
                }];
            const var1 = [{
                    strategy_label: 'Scalp Variant',
                    opportunities: [{
                            symbol: 'ETHUSDT',
                            direction: 'LONG',
                            score: 85,
                            price: 2000,
                            pct: 2.1,
                            signalResult: {
                                allFired: false,
                                firedSignals: [],
                                details: { htf_breakout: { value: 2000, threshold: 2010, live_price: 2000 } },
                            },
                        }],
                }];
            const var2 = [{
                    strategy_label: 'Scalp Variant',
                    opportunities: [{
                            symbol: 'ETHUSDT',
                            direction: 'LONG',
                            score: 85,
                            price: 2000,
                            pct: 2.1,
                            signalResult: {
                                allFired: false,
                                firedSignals: [],
                                details: { htf_breakout: { value: 2000, threshold: 2010, live_price: 2005 } },
                            },
                        }],
                }];
            const fp1 = `${scannerResultsFingerprint(base)}|${scannerVariantsFingerprint(var1)}`;
            const fp2 = `${scannerResultsFingerprint(base)}|${scannerVariantsFingerprint(var2)}`;
            expect(fp1).not.toBe(fp2);
        });
    });
    describe('5. SignalEngineService MACD Filter & Sub-Gate Telemetry', () => {
        it('emits live macd_filter telemetry on ema_dual_cross, macd_impulse, macd_pbc, and macd_fade', () => {
            const prices = Array(100).fill(100);
            for (let i = 60; i < 98; i++) {
                prices[i] = 100 - (i - 60) * 0.5;
            }
            prices[98] = 82;
            prices[99] = 83;
            const candles = prices.map((price, i) => ({
                time: i * 60000,
                open: price - 0.5,
                high: price + 1,
                low: price - 1,
                close: price,
                volume: 1000,
                isCompleted: true,
            }));
            const mockKlineStore = {
                getRawCandles: jest.fn().mockReturnValue(candles),
                getLookbackExtremes: jest.fn(),
            };
            const signalEngine = new SignalEngineService(mockKlineStore);
            const config = new SessionConfig();
            config.enabled_signals = ['ema_dual_cross', 'macd_impulse', 'macd_pbc', 'macd_fade'];
            config.signal_params = {
                entry_ema_fast: 9,
                entry_ema_slow: 21,
                ema_dual_macd_filter: true,
                macd_fast: 12,
                macd_slow: 26,
                macd_signal: 9,
                macd_strict_expansion: true,
                macd_pbc_trend_ema: 50,
                macd_pbc_lookback: 5,
            };
            const res = signalEngine.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
            const d = res.details;
            expect(d.ema_dual_cross?.macd_filter).toBeDefined();
            expect(d.ema_dual_cross.macd_filter.mode).toBe('ema_filter');
            expect(typeof d.ema_dual_cross.macd_filter.histogram).toBe('number');
            expect(d.ema_dual_cross.macd_filter.recent_hist.length).toBeGreaterThan(0);
            expect(d.macd_impulse?.macd_filter).toBeDefined();
            expect(d.macd_impulse.macd_filter.mode).toBe('macd_impulse');
            expect(d.macd_impulse.macd_filter.gates.length).toBe(3);
            expect(d.macd_pbc?.macd_filter).toBeDefined();
            expect(d.macd_pbc.macd_filter.mode).toBe('macd_pbc');
            expect(d.macd_pbc.macd_filter.gates.length).toBe(4);
            expect(d.macd_fade?.macd_filter).toBeDefined();
            expect(d.macd_fade.macd_filter.mode).toBe('macd_fade');
            expect(d.macd_fade.macd_filter.gates.length).toBe(2);
        });
    });
});
