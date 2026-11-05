import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { MaintenanceService } from './maintenance.service';
import { ENGINE_EVENTS } from './events';
describe('SL Ratchet Simulation & Synchronization Suite', () => {
    let orderManager;
    let maintenanceService;
    let mockSignalEngine;
    let mockMarketFeed;
    let mockTickerCache;
    let mockSessionState;
    let mockAuditLog;
    let mockEventEmitter;
    let mockBinanceClient;
    let mockPositionTracker;
    beforeEach(() => {
        mockSignalEngine = {};
        mockMarketFeed = {
            getSymbolFilters: jest.fn().mockReturnValue({
                filters: [
                    { filterType: 'PRICE_FILTER', tickSize: '0.0001' },
                    { filterType: 'LOT_SIZE', stepSize: '1' }
                ],
                pricePrecision: 4,
                qtyPrecision: 0
            })
        };
        mockTickerCache = {
            getTicker: jest.fn().mockReturnValue({ mark_price: 0.1734, price: 0.1734 }),
            getPrice: jest.fn().mockReturnValue(0.1734)
        };
        mockSessionState = {
            isRateLimited: jest.fn().mockReturnValue(false),
            isBanned: jest.fn().mockReturnValue(false),
            isOrderRateLimited: jest.fn().mockReturnValue(false),
            hasOrderCapacity: jest.fn().mockReturnValue(true),
            config: { trailing_guard_buffer_pct: 0.1 },
            realTimeOrders: new Map(),
            realTimePositions: new Map(),
            activeTrades: []
        };
        mockAuditLog = { log: jest.fn() };
        mockEventEmitter = { emit: jest.fn(), on: jest.fn() };
        mockPositionTracker = {
            getInFlightEntry: jest.fn(),
            setInFlight: jest.fn(),
            clearInFlight: jest.fn(),
            isRatcheting: jest.fn().mockReturnValue(false),
            isEntering: jest.fn().mockReturnValue(false),
            isClosing: jest.fn().mockReturnValue(false),
            onRatchetComplete: jest.fn().mockResolvedValue(undefined),
            markDirty: jest.fn(),
            recordRatchetDeferral: jest.fn(),
            activeList: jest.fn().mockReturnValue([]),
            refreshTradeRisk: jest.fn(),
            reconcileMilestoneFromSl: jest.fn(),
            addTrade: jest.fn()
        };
        orderManager = new OrderManagerService(mockSignalEngine, mockMarketFeed, mockTickerCache, { incrementApiRequests: jest.fn() }, mockPositionTracker, mockSessionState, { broadcast: jest.fn() }, mockAuditLog, mockEventEmitter, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) }, new OrderFilterService(mockMarketFeed, mockTickerCache, { broadcast: jest.fn() }));
        mockBinanceClient = {
            restAPI: {
                cancelOrder: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({ status: 'CANCELED' }),
                    headers: { get: () => '0' }
                }),
                cancelAlgoOrder: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({ status: 'CANCELED' }),
                    headers: { get: () => '0' }
                }),
                newAlgoOrder: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve({ algoId: 3000002279948570, code: 200, status: 'NEW' }),
                    headers: { get: () => '0' }
                }),
                queryOrder: jest.fn().mockRejectedValue(new Error('Not found')),
                currentAllAlgoOpenOrders: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve([]),
                    headers: { get: () => '0' }
                }),
                positionInformationV3: jest.fn().mockResolvedValue({
                    data: () => Promise.resolve([]),
                    headers: { get: () => '0' }
                })
            }
        };
        orderManager.setBinanceClient(mockBinanceClient, false);
        maintenanceService = new MaintenanceService(mockPositionTracker, orderManager, mockTickerCache, mockSessionState, mockEventEmitter);
    });
    it('1. Ratchet works on adopted/reconciled trade without binance_order_id', async () => {
        const trade = {
            id: '7ea4f33b-c3da-47ca-8382-3153a05fb131',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.15654,
            binance_stop_order_id: '3000002279948570',
            binance_stop_order_type: 'algo',
            binance_order_id: null // Missing entry order ID
        };
        const result = await orderManager.updateStopLoss(trade, 0.17108, 0.15654);
        expect(result.success).toBe(true);
        expect(result.price).toBe(0.17108);
        expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalledWith({ symbol: 'INITUSDT', algoId: '3000002279948570' });
        expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalled();
    });
    it('2. Ratchet treats Binance code: 200 as successful order placement', async () => {
        const trade = {
            id: 'trade-200',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.15654,
            binance_stop_order_id: '10001',
            binance_stop_order_type: 'algo',
            binance_order_id: 'entry-123'
        };
        mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
            data: () => Promise.resolve({ code: 200, algoId: 999888, msg: 'Success' }),
            headers: { get: () => '0' }
        });
        const result = await orderManager.updateStopLoss(trade, 0.17091, 0.15654);
        expect(result.success).toBe(true);
        expect(trade.binance_stop_order_id).toBe('999888');
    });
    it('3. Ratchet proceeds when trade.current_sl was mutated locally prior to updateStopLoss', async () => {
        const trade = {
            id: 'trade-mutated',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.17108, // Already updated in memory to target price
            binance_stop_order_id: '10001',
            binance_stop_order_type: 'algo',
            binance_order_id: 'entry-123'
        };
        // Passing prevSlPrice = 0.15654 explicitly
        const result = await orderManager.updateStopLoss(trade, 0.17108, 0.15654);
        expect(result.success).toBe(true);
        expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalled();
        expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalled();
    });
    it('4. cancelBinanceOrder handles -2011 "Unknown order sent" and proceeds with new SL placement', async () => {
        const trade = {
            id: 'trade-already-canceled',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.15654,
            binance_stop_order_id: '10001',
            binance_stop_order_type: 'algo',
            binance_order_id: 'entry-123'
        };
        mockBinanceClient.restAPI.cancelAlgoOrder.mockRejectedValueOnce(new Error('Unknown order sent (-2011)'));
        const result = await orderManager.updateStopLoss(trade, 0.17108, 0.15654);
        expect(result.success).toBe(true);
        expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalled();
    });
    it('5. Watchdog detects lagging exchange SL price and triggers updateStopLoss to push ratchet', async () => {
        const trade = {
            id: 'trade-watchdog',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.17108, // Higher target SL in UI
            binance_stop_order_id: '3000002279948570',
            binance_stop_order_type: 'algo',
            binance_order_id: 'entry-123',
            status: 'OPEN',
            updated_at: new Date(Date.now() - 60000) // Older than 45s cooldown
        };
        mockPositionTracker.activeList.mockReturnValue([trade]);
        // Mock exchange returning open position and open SL order at 0.15654 (lagging)
        mockSessionState.realTimePositions.set('INITUSDT', { amount: 270, entryPrice: 0.16961 });
        mockSessionState.realTimeOrders.set('INITUSDT', [{
                algoId: 3000002279948570,
                symbol: 'INITUSDT',
                triggerPrice: 0.15654,
                stopPrice: 0.15654,
                quantity: 270,
                type: 'STOP_MARKET',
                algoType: 'CONDITIONAL',
                status: 'NEW'
            }]);
        const spyUpdateSl = jest.spyOn(orderManager, 'updateStopLoss');
        await maintenanceService.protectionWatchdog(true, { paper_mode: false });
        expect(spyUpdateSl).toHaveBeenCalledWith(trade, 0.17108, 0.15654);
    });
    it('6. Instantly adopts chart-dragged SL order from WebSocket NEW/AMENDMENT event', async () => {
        const trade = {
            id: 'trade-chart-drag',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.15654,
            binance_stop_order_id: 'old-order-1',
            binance_stop_order_type: 'algo',
            status: 'OPEN'
        };
        mockSessionState.activeTrades = [trade];
        // User drags SL line on Binance chart, creating order 888777 at 0.17150
        await orderManager.handleBinanceOrderUpdate({
            e: 'ORDER_TRADE_UPDATE',
            E: Date.now(),
            T: Date.now(),
            o: {
                s: 'INITUSDT',
                c: 'web_chart_drag_123',
                S: 'SELL',
                ot: 'STOP_MARKET',
                sp: '0.17150',
                x: 'NEW',
                X: 'NEW',
                i: 888777,
                q: '0',
                cp: true
            }
        });
        expect(trade.current_sl).toBe(0.1715);
        expect(trade.binance_stop_order_id).toBe('888777');
        expect(mockPositionTracker.refreshTradeRisk).toHaveBeenCalledWith(trade);
    });
    it('7. Recognizes chart-dragged SL fill as SL_HIT when triggered on exchange', async () => {
        const trade = {
            id: 'trade-chart-fill',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.17150,
            initial_sl: 0.15654,
            binance_stop_order_id: '888777',
            status: 'OPEN'
        };
        mockSessionState.activeTrades = [trade];
        // Chart-dragged SL fills on Binance
        await orderManager.handleBinanceOrderUpdate({
            e: 'ORDER_TRADE_UPDATE',
            E: Date.now(),
            T: Date.now(),
            o: {
                s: 'INITUSDT',
                c: 'web_chart_drag_123',
                S: 'SELL',
                ot: 'STOP_MARKET',
                sp: '0.17150',
                x: 'TRADE',
                X: 'FILLED',
                i: 888777,
                q: '270',
                z: '270',
                ap: '0.17145',
                n: '0.015',
                rp: '0.49',
                cp: true
            }
        });
        expect(mockEventEmitter.emit).toHaveBeenCalledWith(ENGINE_EVENTS.EXCHANGE_CLOSE, expect.objectContaining({
            symbol: 'INITUSDT',
            exitPrice: 0.17145,
            reason: expect.stringContaining('SL_HIT')
        }));
    });
    it('8. Watchdog adopts closePosition: true chart order with qty 0 without canceling it as orphan', async () => {
        const trade = {
            id: 'trade-watchdog-cp',
            symbol: 'INITUSDT',
            direction: 'LONG',
            qty: 270,
            entry_price: 0.16961,
            current_sl: 0.15654,
            binance_stop_order_id: 'old-canceled-id',
            binance_order_id: 'entry-123',
            status: 'OPEN',
            updated_at: new Date(Date.now() - 60000)
        };
        mockPositionTracker.activeList.mockReturnValue([trade]);
        mockSessionState.realTimePositions.set('INITUSDT', { amount: 270, entryPrice: 0.16961 });
        // Open order has closePosition: true and quantity 0 as Binance chart drag creates
        mockSessionState.realTimeOrders.set('INITUSDT', [{
                algoId: 999111,
                symbol: 'INITUSDT',
                triggerPrice: 0.17180,
                stopPrice: 0.17180,
                quantity: 0,
                origQty: 0,
                type: 'STOP_MARKET',
                closePosition: true,
                side: 'SELL',
                status: 'NEW'
            }]);
        await maintenanceService.protectionWatchdog(true, { paper_mode: false });
        // Watchdog should adopt the order 999111 rather than canceling it
        expect(trade.binance_stop_order_id).toBe('999111');
        expect(trade.current_sl).toBe(0.1718);
        expect(mockBinanceClient.restAPI.cancelAlgoOrder).not.toHaveBeenCalledWith(expect.objectContaining({ algoId: '999111' }));
    });
    it('9. Ratchet updates exchange order even when trailing_execution_mode is local', async () => {
        mockSessionState.config.trailing_execution_mode = 'local';
        const trade = {
            id: 'trade-local-cfg',
            symbol: 'DOTUSDT',
            direction: 'LONG',
            qty: 140.5,
            entry_price: 1.0128,
            current_sl: 1.0162,
            binance_stop_order_id: '3000002281552472',
            binance_stop_order_type: 'algo',
            binance_order_id: '27409555306',
            strategy_config: { trailing_execution_mode: 'local' }
        };
        mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
            data: () => Promise.resolve({ code: 200, algoId: 3000002281999999, msg: 'Success' }),
            headers: { get: () => '0' }
        });
        const result = await orderManager.updateStopLoss(trade, 1.0162, 0.9886);
        expect(result.success).toBe(true);
        expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalledWith({
            symbol: 'DOTUSDT',
            algoId: '3000002281552472'
        });
        expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalled();
        expect(trade.binance_stop_order_id).toBe('3000002281999999');
    });
    it('10. Watchdog adopts tighter chart-dragged SL from exchange when exchange is more protective', async () => {
        const trade = {
            id: 'trade-chart-protective',
            symbol: 'DOTUSDT',
            direction: 'LONG',
            qty: 140.5,
            entry_price: 1.0128,
            current_sl: 1.0162,
            binance_stop_order_id: '3000002281552472',
            binance_stop_order_type: 'algo',
            status: 'OPEN',
            updated_at: new Date(Date.now() - 60000)
        };
        mockPositionTracker.activeList.mockReturnValue([trade]);
        mockSessionState.realTimePositions.set('DOTUSDT', { amount: 140.5, entryPrice: 1.0128 });
        // User dragged SL higher to 1.0250 on Binance chart
        mockSessionState.realTimeOrders.set('DOTUSDT', [{
                algoId: 3000002281552472,
                symbol: 'DOTUSDT',
                triggerPrice: 1.0250,
                stopPrice: 1.0250,
                quantity: 140.5,
                type: 'STOP_MARKET',
                algoType: 'CONDITIONAL',
                side: 'SELL',
                status: 'NEW'
            }]);
        const spyUpdateSl = jest.spyOn(orderManager, 'updateStopLoss');
        await maintenanceService.protectionWatchdog(true, { paper_mode: false });
        // Watchdog should adopt 1.0250 locally and NOT overwrite exchange with 1.0162
        expect(trade.current_sl).toBe(1.0250);
        expect(spyUpdateSl).not.toHaveBeenCalled();
        expect(mockPositionTracker.refreshTradeRisk).toHaveBeenCalledWith(trade);
    });
});
