import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { ENGINE_EVENTS } from './events';
import { EXIT_REASONS } from '../models/constants';
describe('Chronos: Lifecycle and PnL Integrity', () => {
    let service;
    let mockSignalEngine;
    let mockBinanceClient;
    let mockMarketFeed;
    let mockSessionState;
    let eventEmitter;
    beforeEach(() => {
        mockSignalEngine = { checkEntry: jest.fn() };
        mockMarketFeed = {
            getSymbolFilters: jest.fn().mockReturnValue({
                tickSize: 0.01,
                stepSize: 0.001,
                qtyPrecision: 3,
                pricePrecision: 2
            }),
        };
        mockSessionState = {
            isRateLimited: jest.fn().mockReturnValue(false),
            isBanned: jest.fn().mockReturnValue(false),
            isOrderRateLimited: jest.fn().mockReturnValue(false),
            binanceRateLimit: { used_1m: 0, limit: 2400 },
            realTimeOrders: new Map(),
            realTimePositions: new Map(),
            activeTrades: [],
            getBinanceRateLimit: jest.fn().mockReturnValue({ used_1m: 0, limit: 2400 }),
        };
        eventEmitter = { emit: jest.fn() };
        service = new OrderManagerService(mockSignalEngine, mockMarketFeed, { getTicker: jest.fn(), getPrice: jest.fn() }, { incrementApiRequests: jest.fn() }, { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn(), addTrade: jest.fn() }, mockSessionState, { broadcast: jest.fn() }, { log: jest.fn() }, eventEmitter, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) }, new OrderFilterService(mockMarketFeed, { getTicker: jest.fn(), getPrice: jest.fn() }, { broadcast: jest.fn() }));
        mockBinanceClient = {
            restAPI: {
                userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
                queryOrder: jest.fn(),
            },
        };
        service.setBinanceClient(mockBinanceClient, false);
    });
    describe('Liquidation Handling (Binance FAPI CALCULATED)', () => {
        it('should process CALCULATED execution type as an authoritative closure', async () => {
            const trade = {
                id: 'trade-liq',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                qty: 0.1,
                entry_price: 50000,
                status: 'OPEN',
            };
            mockSessionState.activeTrades = [trade];
            // Simulate Liquidation Event (executionType 'CALCULATED' on Binance)
            const liquidationEvent = {
                o: {
                    s: 'BTCUSDT',
                    X: 'FILLED',
                    i: 123456,
                    S: 'SELL',
                    ot: 'LIQUIDATION',
                    x: 'CALCULATED',
                    q: '0.1',
                    z: '0.1',
                    ap: '45000',
                    n: '0',
                    rp: '-500',
                    t: 999999,
                    T: Date.now()
                }
            };
            await service.handleBinanceOrderUpdate(liquidationEvent);
            // EXPECTATION: It should NOT be ignored. It should trigger EXCHANGE_CLOSE.
            expect(eventEmitter.emit).toHaveBeenCalledWith(ENGINE_EVENTS.EXCHANGE_CLOSE, expect.objectContaining({
                symbol: 'BTCUSDT',
                exitPrice: 45000,
                reason: expect.stringContaining('EXCHANGE_FILL'),
                alreadyRealized: true
            }));
        });
    });
    describe('Incremental PnL Integrity (Multi-part Execution)', () => {
        it('should NOT double-count the final slice PnL in closeTrade', async () => {
            const trade = {
                id: 'trade-multipart',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                qty: 0.1,
                entry_price: 50000,
                initial_sl: 49000,
                initial_risk_usdt: 100, // (50000 - 49000) * 0.1
                pnl: 0,
                binance_close_order_id: 'exit-111',
                status: 'OPEN',
            };
            mockSessionState.activeTrades = [trade];
            // 1. UDS Slice 1 arrives (Partial Fill 0.05)
            const slice1 = {
                o: {
                    s: 'BTCUSDT',
                    X: 'PARTIALLY_FILLED',
                    i: 'exit-111',
                    S: 'SELL',
                    ot: 'MARKET',
                    x: 'TRADE',
                    q: '0.1',
                    z: '0.05',
                    l: '0.05',
                    ap: '51000',
                    n: '1.02',
                    rp: '50',
                    t: 1001,
                    T: Date.now()
                }
            };
            await service.handleBinanceOrderUpdate(slice1);
            expect(trade.pnl).toBe(48.98);
            expect(trade.qty).toBe(0.05);
            // 2. UDS Slice 2 arrives (Final Fill 0.05)
            const slice2 = {
                o: {
                    s: 'BTCUSDT',
                    X: 'FILLED',
                    i: 'exit-111',
                    S: 'SELL',
                    ot: 'MARKET',
                    x: 'TRADE',
                    q: '0.1',
                    z: '0.1',
                    l: '0.05',
                    ap: '51000',
                    n: '1.02',
                    rp: '50',
                    t: 1002,
                    T: Date.now()
                }
            };
            await service.handleBinanceOrderUpdate(slice2);
            expect(trade.pnl).toBe(97.96);
            // 3. Now simulate the resulting closeTrade call
            const lastEmit = eventEmitter.emit.mock.calls.find((c) => c[0] === ENGINE_EVENTS.EXCHANGE_CLOSE);
            const payload = lastEmit[1];
            expect(payload.alreadyRealized).toBe(true);
            const result = await service.closeTrade('BTCUSDT', trade, 51000, EXIT_REASONS.EXCHANGE_FILL, false, true, {
                alreadyRealized: payload.alreadyRealized,
                feesAlreadyAccounted: payload.feesAlreadyAccounted
            });
            expect(result.trade.pnl).toBe(97.96);
            expect(result.trade.qty).toBe(0.1);
        });
    });
});
