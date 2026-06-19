import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { Trade } from '../models/Trade';
import { ExecutionStatus } from '../models/ExecutionResult';

describe('PnL/Balance Inconsistency Reproduction', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;

  beforeEach(() => {
    sessionState = new SessionStateService();
    // @ts-ignore
    sessionState.logger = { log: jest.fn(), verbose: jest.fn(), warn: jest.fn(), error: jest.fn() };

    sessionState.reset({
      paper_starting_balance: 10000,
      paper_mode: true,
      trading_mode: 'paper'
    } as any);

    orderManager = new OrderManagerService(
      {} as any, // signalEngine
      { getSymbolFilters: () => null } as any, // marketFeed
      { getTicker: jest.fn(), getPrice: jest.fn() } as any, // tickerCache
      { incrementApiRequests: jest.fn() } as any, // monitoringService
      sessionState,
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any // eventEmitter
    );
  });

  it('should correctly update balance after entry and exit in paper mode', async () => {
    // @ts-ignore
    orderManager.updateBalance = async (t: Trade) => {
        // DATA-05: Delta-based balance updates to prevent double-counting of fees/PnL
        // @ts-ignore
        if (!orderManager.appliedPnL) orderManager.appliedPnL = new Map();
        const totalPnl = t.pnl || 0;
        // @ts-ignore
        const previouslyApplied = orderManager.appliedPnL.get(t.id) || 0;
        const pnlDelta = Number((totalPnl - previouslyApplied).toFixed(8));

        if (pnlDelta !== 0) {
            sessionState.balancePaper = Number((sessionState.balancePaper + pnlDelta).toFixed(8));
            // @ts-ignore
            orderManager.appliedPnL.set(t.id, totalPnl);
        }
    };

    const entryPrice = 100;
    const qty = 10; // Notional = 1000
    // Simulated fee rate is 0.0004
    const entryFee = 1000 * 0.0004; // 0.4

    // 1. Simulate Entry
    const enterResult = await orderManager.enter(
      'session-1',
      'BTCUSDT',
      'LONG',
      entryPrice,
      qty,
      90, // SL
      110, // TP
      {}
    );

    expect(enterResult.status).toBe(ExecutionStatus.SUCCESS);
    const trade = enterResult.data as Trade;
    expect(trade.realized_fee).toBe(entryFee);
    expect(trade.pnl).toBe(-entryFee);

    // Simulate updateBalance(t) as done in TradingSessionService/ExecutionService
    // @ts-ignore
    await orderManager.updateBalance(trade);

    // Expected Balance: 10000 - 0.4 = 9999.6
    expect(sessionState.balancePaper).toBe(9999.6);

    // 2. Simulate Exit at 105
    const exitPrice = 105;
    const exitFee = 105 * 10 * 0.0004; // 0.42
    const grossPnl = (105 - 100) * 10; // 50
    const expectedNetPnl = grossPnl - entryFee - exitFee; // 50 - 0.4 - 0.42 = 49.18

    const exitResult = await orderManager.closeTrade(
      'BTCUSDT',
      trade,
      exitPrice,
      'TP_HIT',
      true // paperMode
    );

    expect(exitResult.exitOccurred).toBe(true);
    expect(Number(trade.realized_fee.toFixed(8))).toBe(Number((entryFee + exitFee).toFixed(8)));
    expect(Number(trade.pnl.toFixed(8))).toBe(Number(expectedNetPnl.toFixed(8)));

    // Simulate updateBalance(t) as done in TradingSessionService/ExecutionService
    const previousBalance = sessionState.balancePaper;
    // @ts-ignore
    await orderManager.updateBalance(trade);

    // Ideal Balance should be: Starting (10000) + Net PnL (49.18) = 10049.18
    // Actual Balance with bug: 9999.6 + 49.18 = 10048.78 (Missing 0.4)
    console.log(`Initial Balance: 10000`);
    console.log(`Balance after entry: ${previousBalance}`);
    console.log(`Trade Net PnL: ${trade.pnl}`);
    console.log(`Final Balance: ${sessionState.balancePaper}`);

    expect(sessionState.balancePaper).toBe(10049.18);
  });
});
