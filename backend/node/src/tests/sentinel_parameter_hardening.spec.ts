import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SessionController } from '../trading/session.controller';
import { SessionService } from '../trading/session.service';
import { BacktestService } from '../engine/backtest.service';
import { SmartOptimizerService } from '../engine/smart-optimizer.service';
import { ConfigService } from '@nestjs/config';

describe('Sentinel: Parameter and Query Input Hardening', () => {
  let controller: SessionController;
  let mockSessionService: any;

  let mockBacktestService: any;

  beforeEach(async () => {
    mockSessionService = {
      getTrade: jest.fn().mockResolvedValue({ id: 'valid-trade-id' }),
      updateTradeConfig: jest.fn().mockResolvedValue({ status: 'updated' }),
      getHistory: jest.fn().mockResolvedValue([]),
      closeTradeManually: jest.fn().mockResolvedValue({ success: true }),
      startSession: jest.fn().mockResolvedValue({ strategyId: 'session-123', status: 'started' }),
    };

    mockBacktestService = {
      runBacktest: jest.fn().mockResolvedValue({ totalTrades: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
        {
          provide: BacktestService,
          useValue: mockBacktestService,
        },
        {
          provide: SmartOptimizerService,
          useValue: {
            getTopRecommendations: jest.fn().mockReturnValue([]),
            clearRecommendations: jest.fn(),
            runOptimization: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('secret-key'),
          },
        },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  describe('getTrade Input Hardening', () => {
    it('should allow valid UUID format', async () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      await expect(controller.getTrade(validUuid)).resolves.not.toThrow();
      expect(mockSessionService.getTrade).toHaveBeenCalledWith(validUuid);
    });

    it('should allow valid Binance symbol format', async () => {
      const validSymbol = 'BTCUSDT';
      await expect(controller.getTrade(validSymbol)).resolves.not.toThrow();
      expect(mockSessionService.getTrade).toHaveBeenCalledWith(validSymbol);
    });

    it('should reject parameter that is too long (> 50 characters) to prevent ReDoS', async () => {
      const massiveParam = 'A'.repeat(51);
      await expect(controller.getTrade(massiveParam)).rejects.toThrow(
        new BadRequestException('Invalid trade ID or symbol format')
      );
      expect(mockSessionService.getTrade).not.toHaveBeenCalled();
    });

    it('should reject invalid format within size bounds', async () => {
      const invalidShort = 'invalid!';
      await expect(controller.getTrade(invalidShort)).rejects.toThrow(
        new BadRequestException('Invalid trade ID or symbol format')
      );
      expect(mockSessionService.getTrade).not.toHaveBeenCalled();
    });

    it('should reject non-string input (array/object) to prevent HPP type confusion', async () => {
      await expect(controller.getTrade(['BTCUSDT'] as any)).rejects.toThrow(
        new BadRequestException('Invalid trade ID or symbol format')
      );
      expect(mockSessionService.getTrade).not.toHaveBeenCalled();
    });
  });

  describe('updateTradeConfig Input Hardening', () => {
    it('should accept valid UUID and body config', async () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.updateTradeConfig(validUuid, {}, mockReq)).resolves.not.toThrow();
      expect(mockSessionService.updateTradeConfig).toHaveBeenCalledWith(
        validUuid,
        {},
        '127.0.0.1',
        undefined
      );
    });

    it('should reject parameters that are too long (> 50 characters) to prevent ReDoS', async () => {
      const massiveParam = 'B'.repeat(51);
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.updateTradeConfig(massiveParam, {}, mockReq)).rejects.toThrow(
        new BadRequestException('Invalid trade ID or symbol format')
      );
      expect(mockSessionService.updateTradeConfig).not.toHaveBeenCalled();
    });

    it('should reject non-string input (array/object) to prevent HPP type confusion', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.updateTradeConfig(['123e4567-e89b-12d3-a456-426614174000'] as any, {}, mockReq)).rejects.toThrow(
        new BadRequestException('Invalid trade ID or symbol format')
      );
      expect(mockSessionService.updateTradeConfig).not.toHaveBeenCalled();
    });
  });

  describe('getHistory Input Hardening', () => {
    it('should allow "all" or valid UUID as sessionId', async () => {
      await expect(controller.getHistory('all')).resolves.not.toThrow();
      await expect(controller.getHistory('123e4567-e89b-12d3-a456-426614174000')).resolves.not.toThrow();
    });

    it('should reject sessionId query options that are too long (> 50 characters)', async () => {
      const massiveSessionId = 'C'.repeat(51);
      await expect(controller.getHistory(massiveSessionId)).rejects.toThrow(
        new BadRequestException('Invalid sessionId format')
      );
      expect(mockSessionService.getHistory).not.toHaveBeenCalled();
    });

    it('should reject malformed sessionId within size bounds', async () => {
      const invalidSessionId = 'not-a-uuid';
      await expect(controller.getHistory(invalidSessionId)).rejects.toThrow(
        new BadRequestException('Invalid sessionId format')
      );
      expect(mockSessionService.getHistory).not.toHaveBeenCalled();
    });
  });

  describe('closeTradeManually Input Hardening', () => {
    it('should allow valid symbols', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.closeTradeManually('BTCUSDT', mockReq)).resolves.not.toThrow();
      expect(mockSessionService.closeTradeManually).toHaveBeenCalledWith('BTCUSDT', '127.0.0.1', undefined);
    });

    it('should reject symbol parameters that are too long (> 50 characters)', async () => {
      const massiveSymbol = 'D'.repeat(51);
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.closeTradeManually(massiveSymbol, mockReq)).rejects.toThrow(
        new BadRequestException('Invalid symbol format')
      );
      expect(mockSessionService.closeTradeManually).not.toHaveBeenCalled();
    });

    it('should reject symbols with special or dangerous characters', async () => {
      const badSymbol = 'BTC; DROP TABLE trades;';
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.closeTradeManually(badSymbol, mockReq)).rejects.toThrow(
        new BadRequestException('Invalid symbol format')
      );
      expect(mockSessionService.closeTradeManually).not.toHaveBeenCalled();
    });

    it('should reject non-string symbol input (array/object) to prevent HPP type confusion', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.closeTradeManually(['BTCUSDT'] as any, mockReq)).rejects.toThrow(
        new BadRequestException('Invalid symbol format')
      );
      expect(mockSessionService.closeTradeManually).not.toHaveBeenCalled();
    });
  });

  describe('runBacktest Strategy Config Whitelist Validation', () => {
    it('should accept valid strategy configuration in runBacktest', async () => {
      const validPayload = {
        config: {
          strategy_label: 'Backtest Test Strategy',
          scan_interval: '5m',
        },
      };
      await expect(controller.runBacktest(validPayload as any)).resolves.not.toThrow();
      expect(mockBacktestService.runBacktest).toHaveBeenCalled();
    });

    it('should reject non-whitelisted properties in runBacktest strategy configuration', async () => {
      const invalidPayload = {
        config: {
          strategy_label: 'Valid Strategy',
          unauthorized_extra_param: '<script>alert(1)</script>',
        },
      };
      await expect(controller.runBacktest(invalidPayload as any)).rejects.toThrow(
        BadRequestException
      );
      expect(mockBacktestService.runBacktest).not.toHaveBeenCalled();
    });

    it('should reject invalid property values in runBacktest strategy configuration', async () => {
      const invalidPayload = {
        config: {
          strategy_label: 'Invalid <script>alert(1)</script>',
        },
      };
      await expect(controller.runBacktest(invalidPayload as any)).rejects.toThrow(
        BadRequestException
      );
      expect(mockBacktestService.runBacktest).not.toHaveBeenCalled();
    });
  });

  describe('startSession Strategy Config Whitelist Validation', () => {
    it('should accept valid strategy configuration in startSession', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const validPayload = {
        paper_mode: true,
        config: {
          strategy_label: 'Live Strategy',
          scan_interval: '15m',
        },
      };
      await expect(controller.startSession(validPayload as any, mockReq)).resolves.not.toThrow();
      expect(mockSessionService.startSession).toHaveBeenCalled();
    });

    it('should reject non-whitelisted properties in startSession strategy configuration', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const invalidPayload = {
        paper_mode: true,
        config: {
          strategy_label: 'Live Strategy',
          malicious_injection_field: 'drop database',
        },
      };
      await expect(controller.startSession(invalidPayload as any, mockReq)).rejects.toThrow(
        BadRequestException
      );
      expect(mockSessionService.startSession).not.toHaveBeenCalled();
    });
  });
});
