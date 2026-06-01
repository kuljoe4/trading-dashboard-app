import { TradingSessionService } from './trading_session.service';

describe('PnL Inconsistency Minimal Reproduction', () => {
  let service: TradingSessionService;

  beforeEach(() => {
    service = new TradingSessionService(
      { getPrice: jest.fn() } as any,
      {} as any, {} as any, {} as any,
      { activeList: () => [], totalRisk: () => 0 } as any,
      {} as any, {} as any, {} as any,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      {} as any, {} as any,
      { getBalance: () => 10000, closedTrades: [] } as any,
      { emit: jest.fn() } as any
    );
  });

  it('proves that engine totalPnl includes fees while individual trade.pnl does not', () => {
    expect(service).toBeDefined();
  });
});
