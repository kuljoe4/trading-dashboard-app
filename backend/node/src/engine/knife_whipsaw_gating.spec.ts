import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Knife Catch Anti-Whipsaw Bypass & Gated Entry Allowance', () => {
  let riskEngine: RiskEngineService;

  beforeEach(() => {
    riskEngine = new RiskEngineService();
  });

  describe('RiskEngine.canEnter - Gated Knife Entry Allowance', () => {
    it('should allow knife trade entry when max_open_trades is reached if allow_knife_when_gated is true and 0 active knife trades exist', () => {
      const config = new SessionConfig();
      config.max_open_trades = 1;
      config.allow_knife_when_gated = true;

      const activeTrade = {
        id: 'trade-1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        status: 'OPEN',
        entry_price: 50000,
        qty: 0.1,
        sl_price: 49000,
        initial_sl: 49000,
        current_sl: 49000,
        risk_usdt: 10,
        is_knife: false,
      } as Trade;

      const result = riskEngine.canEnter(
        [activeTrade],
        [],
        1000,
        'ETHUSDT',
        config,
        10,
        0
      );

      // Since allow_knife_when_gated is true and activeTrade.is_knife is false (0 active knife trades), maxOpenTrades limit is bypassed
      expect(result.canEnter).toBe(true);
      expect(result.reason).toBe('OK');
    });

    it('should block entry when max_open_trades is reached if 1 active knife trade already exists', () => {
      const config = new SessionConfig();
      config.max_open_trades = 1;
      config.allow_knife_when_gated = true;

      const activeKnifeTrade = {
        id: 'trade-1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        status: 'OPEN',
        entry_price: 50000,
        qty: 0.1,
        sl_price: 49000,
        initial_sl: 49000,
        current_sl: 49000,
        risk_usdt: 10,
        is_knife: true,
      } as Trade;

      const result = riskEngine.canEnter(
        [activeKnifeTrade],
        [],
        1000,
        'ETHUSDT',
        config,
        10,
        0
      );

      // Since 1 active knife trade exists, allow_knife_when_gated does NOT bypass maxOpenTrades
      expect(result.canEnter).toBe(false);
      expect(result.reason).toContain('Global max open trades (1) reached');
    });
  });
});
