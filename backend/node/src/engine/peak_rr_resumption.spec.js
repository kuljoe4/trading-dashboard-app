import { PositionTrackerService } from './positionTracker';
import { EngineBroadcasterService } from './engine-broadcaster.service';
describe('Peak RR Resumption and Hydration Tests', () => {
    let positionTracker;
    let engineBroadcaster;
    const mockRiskEngine = {
        computeSl: jest.fn(),
        computePositionSize: jest.fn(),
    };
    const mockSignalEngine = {};
    const mockOrderManager = {
        checkExitSignals: jest.fn().mockReturnValue({ exitTriggered: false }),
        applyFilters: jest.fn((sym, p) => ({ price: p })),
    };
    const mockTickerCache = {
        getPrice: jest.fn().mockReturnValue(null),
    };
    const mockKlineStore = {};
    const mockSessionState = {
        setActiveTrades: jest.fn(),
    };
    const mockEventEmitter = {
        emit: jest.fn(),
    };
    const defaultConfig = {
        paper_mode: true,
        live_rr_sequence: [1.5, 2.5, 3.5],
        exit_rr_sequence: [0, 1.0, 2.0],
    };
    beforeEach(() => {
        jest.clearAllMocks();
        positionTracker = new PositionTrackerService(mockRiskEngine, mockSignalEngine, mockOrderManager, mockTickerCache, mockKlineStore, mockSessionState, mockEventEmitter);
        engineBroadcaster = new EngineBroadcasterService(mockTickerCache, mockSessionState, {}, { calculateAnalytics: jest.fn().mockReturnValue(null) }, { broadcast: jest.fn() }, {}, mockRiskEngine, positionTracker);
    });
    describe('hydrateMaxRr & addTrade', () => {
        it('coerces string decimal max_rr_achieved from DB to number', () => {
            const trade = {
                id: 't-1',
                symbol: 'BTCUSDT',
                direction: 'LONG',
                entry_price: 100,
                initial_sl: 90,
                current_sl: 90,
                qty: 1,
                status: 'OPEN',
                max_rr_achieved: '2.40000000',
                rr_sequence_index: -1,
            };
            positionTracker.addTrade(trade);
            expect(typeof trade.max_rr_achieved).toBe('number');
            expect(trade.max_rr_achieved).toBe(2.4);
        });
        it('floors max_rr_achieved from milestone index when resumed with 0', () => {
            const trade = {
                id: 't-2',
                symbol: 'ETHUSDT',
                direction: 'LONG',
                entry_price: 100,
                initial_sl: 90,
                current_sl: 100,
                qty: 1,
                status: 'OPEN',
                max_rr_achieved: 0,
                rr_sequence_index: 1, // Milestone index 1 corresponds to live_rr 2.5
                live_rr_sequence: [1.5, 2.5, 3.5],
            };
            positionTracker.addTrade(trade);
            expect(trade.max_rr_achieved).toBe(2.5);
        });
        it('floors max_rr_achieved from locked SL in profit when resumed with 0', () => {
            const trade = {
                id: 't-3',
                symbol: 'SOLUSDT',
                direction: 'LONG',
                entry_price: 100,
                initial_sl: 90, // Risk = 10
                current_sl: 115, // Locked profit = 15 = 1.5R
                qty: 1,
                status: 'OPEN',
                max_rr_achieved: 0,
                rr_sequence_index: -1,
            };
            positionTracker.addTrade(trade);
            expect(trade.max_rr_achieved).toBe(1.5);
        });
        it('floors max_rr_achieved from current ticker price in profit', () => {
            mockTickerCache.getPrice.mockReturnValue(118); // Live profit = 18 = 1.8R
            const trade = {
                id: 't-4',
                symbol: 'ADAUSDT',
                direction: 'LONG',
                entry_price: 100,
                initial_sl: 90,
                current_sl: 90,
                qty: 1,
                status: 'OPEN',
                max_rr_achieved: 0,
                rr_sequence_index: -1,
            };
            positionTracker.addTrade(trade);
            expect(trade.max_rr_achieved).toBe(1.8);
        });
    });
    describe('reconcileMilestoneFromSl', () => {
        it('reconciles max_rr_achieved to milestone RR even if rr_sequence_index is unchanged', () => {
            const trade = {
                id: 't-5',
                symbol: 'DOGEUSDT',
                direction: 'LONG',
                entry_price: 100,
                initial_sl: 90, // Risk = 10
                current_sl: 110, // exit_rr_sequence[1] = 1.0 => SL at 110
                qty: 1,
                status: 'OPEN',
                max_rr_achieved: 0,
                rr_sequence_index: 1, // Already set to 1 in DB
                live_rr_sequence: [1.5, 2.5, 3.5],
                exit_rr_sequence: [0, 1.0, 2.0],
            };
            const bestIndex = positionTracker.reconcileMilestoneFromSl(trade, 110, defaultConfig);
            expect(bestIndex).toBe(1);
            expect(trade.max_rr_achieved).toBe(2.5);
        });
    });
    describe('EngineBroadcasterService serialization', () => {
        it('outputs both max_rr and max_rr_achieved as numbers in serializeTrade and serializeTickTrade', () => {
            const trade = {
                id: 't-6',
                symbol: 'AVAXUSDT',
                direction: 'LONG',
                entry_price: 100,
                initial_sl: 90,
                current_sl: 100,
                qty: 1,
                status: 'OPEN',
                max_rr_achieved: 2.5,
                rr_sequence_index: 1,
            };
            const serialized = engineBroadcaster.serializeTrade(trade, defaultConfig, 105);
            expect(serialized.max_rr).toBe(2.5);
            expect(serialized.max_rr_achieved).toBe(2.5);
            const tickSerialized = engineBroadcaster.serializeTickTrade(trade, defaultConfig, 105, 5, 0.5);
            expect(tickSerialized.max_rr).toBe(2.5);
            expect(tickSerialized.max_rr_achieved).toBe(2.5);
        });
    });
});
