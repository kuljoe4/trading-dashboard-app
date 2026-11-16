import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { EXIT_REASONS } from '../models/constants';
import { ENGINE_EVENTS } from './events';
describe('Race Condition & Edge Case Fixes', () => {
    let orderManager;
    let positionTracker;
    let sessionState;
    let mockBinanceClient;
    let mockEventEmitter;
    beforeEach(() => {
        sessionState = new SessionStateService();
        // Initialize session state
        sessionState.reset({ strategy_label: 'Test' });
        const mockSignalEngine = { checkEntry: jest.fn(), checkExitSignals: jest.fn() };
        const mockMarketFeed = { getSymbolFilters: jest.fn().mockReturnValue({ tickSize: 0.0001, stepSize: 1, multiplierUp: 1.05, multiplierDown: 0.95, pricePrecision: 4, qtyPrecision: 0 }) };
        const mockTickerCache = { getTicker: jest.fn().mockReturnValue({ mark_price: 100 }), getPrice: jest.fn().mockReturnValue(100) };
        const mockMonitoring = { incrementApiRequests: jest.fn() };
        const mockAuditLog = { log: jest.fn() };
        mockEventEmitter = { emit: jest.fn(), on: jest.fn() };
        positionTracker = new PositionTrackerService({}, mockSignalEngine, {}, // placeholder for orderManager
        mockTickerCache, {}, sessionState, mockEventEmitter);
        orderManager = new OrderManagerService(mockSignalEngine, mockMarketFeed, mockTickerCache, mockMonitoring, positionTracker, sessionState, { broadcast: jest.fn() }, // broadcastService
        mockAuditLog, mockEventEmitter, { findOne: jest.fn(), update: jest.fn() }, new OrderFilterService(mockMarketFeed, mockTickerCache, { broadcast: jest.fn() }));
        // Fix circular dependency in positionTracker
        positionTracker.orderManager = orderManager;
        mockBinanceClient = {
            restAPI: {
                newOrder: jest.fn(),
                newAlgoOrder: jest.fn(),
                cancelOrder: jest.fn(),
                cancelAlgoOrder: jest.fn(),
                cancelAllOpenOrders: jest.fn(),
                cancelAllAlgoOpenOrders: jest.fn(),
                queryOrder: jest.fn(),
                queryAlgoOrder: jest.fn(),
                positionInformationV3: jest.fn(),
                notionalAndLeverageBrackets: jest.fn(),
                accountTradeList: jest.fn(),
            }
        };
    });
    it('exhaustiveSymbolFlush uses cancelAllAlgoOpenOrders', async () => {
        await orderManager.setBinanceClient(mockBinanceClient, false);
        mockBinanceClient.restAPI.cancelAllOpenOrders.mockResolvedValue({ data: () => Promise.resolve({}), headers: {} });
        mockBinanceClient.restAPI.cancelAllAlgoOpenOrders.mockResolvedValue({ data: () => Promise.resolve({}), headers: {} });
        await orderManager.exhaustiveSymbolFlush('BTCUSDT');
        expect(mockBinanceClient.restAPI.cancelAllAlgoOpenOrders).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
    });
    it('applyFilters applies safety buffer to PERCENT_PRICE', async () => {
        await orderManager.setBinanceClient(mockBinanceClient, false); // Live mode
        // markPrice = 100, multiplierUp = 1.05 -> maxPrice = 105
        // Safety buffer 0.5% -> bufferedMax = 105 * 0.995 = 104.475
        const result = orderManager.applyFilters('BTCUSDT', 104.8, 1, { clampToPercentPrice: true });
        expect(result.price).toBeLessThan(104.5);
        expect(result.price).toBeGreaterThan(104.4);
    });
    it('validateSlippage handles promoted trades via EXCHANGE_CLOSE event', async () => {
        await orderManager.setBinanceClient(mockBinanceClient, false);
        const trade = { id: 'test-id', symbol: 'BTCUSDT', direction: 'LONG', entry_price: 100, qty: 1 };
        // Simulate trade already promoted to sessionState
        sessionState.activeTrades = [trade];
        const emitSpy = jest.spyOn(mockEventEmitter, 'emit');
        // Entry price 95 with SL 98 -> AT OR PAST SL
        const result = await orderManager.validateSlippage('BTCUSDT', trade, 100, 95, 98);
        expect(result.isValid).toBe(false);
        expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.EXCHANGE_CLOSE, expect.objectContaining({
            symbol: 'BTCUSDT',
            exitPrice: 95,
            reason: EXIT_REASONS.ENTRY_AT_OR_PAST_SL,
            needsMarketClose: true
        }));
    });
    it('notionalAndLeverageBrackets is used instead of leverageBracket', async () => {
        await orderManager.setBinanceClient(mockBinanceClient, false);
        mockBinanceClient.restAPI.notionalAndLeverageBrackets.mockResolvedValue({
            data: () => Promise.resolve([{ symbol: 'BTCUSDT', brackets: [] }]),
            headers: {}
        });
        mockBinanceClient.restAPI.positionInformationV3.mockResolvedValue({
            data: () => Promise.resolve([]),
            headers: {}
        });
        await orderManager.checkLeverageBracket('BTCUSDT', 1000);
        expect(mockBinanceClient.restAPI.notionalAndLeverageBrackets).toHaveBeenCalled();
    });
});
