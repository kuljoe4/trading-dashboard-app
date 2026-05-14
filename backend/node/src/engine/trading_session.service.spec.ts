import { TradingSessionService } from './trading_session.service'

describe('TradingSessionService', () => {
  let service: TradingSessionService
  let broadcaster: jest.Mock

  beforeEach(() => {
    broadcaster = jest.fn()
    service = new TradingSessionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { activeList: () => [], remove: jest.fn(), totalRisk: () => 0 } as any,
      {} as any,
      { start: async () => {}, stop: async () => {} } as any,
      { start: async () => {}, stop: async () => {} } as any,
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
    )
    service.setWsBroadcaster(broadcaster)
  })

  it('serializes trade with finite pnl and rr values', () => {
    const trade = {
      direction: 'LONG',
      entry_price: 100,
      qty: 2,
      current_sl: 95,
      tp: 110,
      max_rr_achieved: 1.5,
      live_rr_sequence: [],
      exit_rr_sequence: [],
    }

    const serialized = (service as any).serializeTrade(trade, 103)

    expect(serialized.current_price).toBe(103)
    expect(serialized.pnl).toBe(6)
    expect(serialized.rr).toBeCloseTo(0.6)
    expect(serialized.max_rr).toBe(1.5)
    expect(serialized.tp_price).toBe(110)
  })

  it('broadcasts session_terminated when stopping', async () => {
    await service.stop()

    expect(broadcaster).toHaveBeenCalled()
    expect(broadcaster.mock.calls.some(call => call[0]?.type === 'session_terminated')).toBe(true)
  })
})
