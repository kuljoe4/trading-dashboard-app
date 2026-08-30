import 'reflect-metadata';
import { SessionService } from '../trading/session.service';
import { SessionConfig } from '../models/SessionConfig';
import { UpdateTradeConfigDto } from '../trading/dto/session.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';

describe('Sentinel: Nested Configuration Gating & Validation', () => {
  let service: SessionService;

  beforeEach(() => {
    // Instantiate SessionService with minimal dummy mocks since validateConfig is a synchronous pure validator
    service = new SessionService(
      {} as any, // sessionRepository
      {} as any, // tradeRepository
      {} as any, // logRepository
      {} as any, // settingsRepository
      {} as any, // balanceHistoryRepository
      {} as any, // tradingSessionService
      {} as any, // orderManager
      {} as any, // marketFeed
      { emit: jest.fn() } as any, // EventEmitter2
      {} as any, // analyticsService
      {} as any, // rrOptimizationService
      {} as any, // binanceClientFactory
      {} as any, // auditLog
      { get: jest.fn() } as any // ConfigService
    );
  });

  it('should accept nested config blocks if they are fully valid', () => {
    const config = {
      strategy_variants: [
        {
          strategy_label: 'Variant LONG Only',
          entry_side: 'long',
          exit_signal_delays: { momentum_pct: 120 },
        },
      ],
      single_symbol_configs: [
        {
          symbol: 'BTCUSDT',
          use_custom_config: true,
          custom_config: {
            strategy_label: 'BTC Custom config',
            exit_signal_delays: { momentum_pct: 60 },
          },
        },
      ],
    } as any;

    expect(() => (service as any).validateConfig(config)).not.toThrow();
  });

  it('should recursively reject invalid configurations inside strategy_variants', () => {
    const invalidConfig = {
      strategy_variants: [
        {
          strategy_label: 'Variant with invalid delay',
          // exit_signal_delays has a negative value, which is blocked by validateConfig
          exit_signal_delays: { momentum_pct: -60 },
        },
      ],
    } as any;

    expect(() => (service as any).validateConfig(invalidConfig)).toThrow(
      'exit_signal_delays values must be numbers between 0 and 86400'
    );
  });

  it('should recursively reject invalid configurations inside single_symbol_configs custom_config', () => {
    const invalidConfig = {
      single_symbol_configs: [
        {
          symbol: 'BTCUSDT',
          use_custom_config: true,
          custom_config: {
            strategy_label: 'BTC with invalid delay',
            exit_signal_delays: { momentum_pct: 100000 }, // exceeds 86400 max
          },
        },
      ],
    } as any;

    expect(() => (service as any).validateConfig(invalidConfig)).toThrow(
      'exit_signal_delays values must be numbers between 0 and 86400'
    );
  });

  it('should recursively check and reject invalid sequences nested inside custom configs', () => {
    const invalidConfig = {
      strategy_variants: [
        {
          tp_mode: 'exp_rr_seq',
          live_rr_sequence: [1, 2],
          exit_rr_sequence: [1, 2, 3], // Length mismatch
        },
      ],
    } as any;

    expect(() => (service as any).validateConfig(invalidConfig)).toThrow(
      'Exit RR sequence must match Live RR sequence length'
    );
  });

  describe('UpdateTradeConfigDto strategy_config validation', () => {
    it('should validate strategy_config nested properties when instantiated and validated', async () => {
      const invalidPayload = {
        strategy_config: {
          strategy_label: 'Invalid <script>alert(1)</script>',
        },
      };

      const dtoInstance = plainToInstance(UpdateTradeConfigDto, invalidPayload);
      const errors = await validate(dtoInstance);
      expect(errors.length).toBeGreaterThan(0);
      const strategyConfigError = errors.find((e) => e.property === 'strategy_config');
      expect(strategyConfigError).toBeDefined();
      expect(strategyConfigError?.children?.length).toBeGreaterThan(0);
    });

    it('should pass validation when valid strategy_config is provided', async () => {
      const validPayload = {
        strategy_config: {
          strategy_label: 'Safe Strategy Label',
        },
      };

      const dtoInstance = plainToInstance(UpdateTradeConfigDto, validPayload);
      const errors = await validate(dtoInstance);
      expect(errors.length).toBe(0);
    });
  });
});
