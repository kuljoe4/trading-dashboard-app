import { TradingSessionService } from './trading_session.service';

describe('TradingSessionService', () => {
  let service: TradingSessionService;

  beforeEach(() => {
    service = new TradingSessionService(
      {} as any, {} as any, {} as any, {} as any,
      { activeList: () => [], activeCount: () => 0, totalRisk: () => 0 } as any,
      {} as any, {} as any, {} as any,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      {} as any, {} as any,
      { reset: jest.fn(), getBalance: () => 10000, closedTrades: [] } as any,
      { emit: jest.fn() } as any
    );
  });

  it('serializes trade with finite pnl and rr values', () => {
    const trade = {
      symbol: 'BTCUSDT',
      entry_price: 50000,
      initial_sl: 49000,
      qty: 0.1,
      status: 'OPEN'
    };
    const serialized = (service as any).serializeTrade(trade, 51000);
    expect(serialized.pnl).toBe(100);
    expect(serialized.rr).toBe(1);
  });
});
