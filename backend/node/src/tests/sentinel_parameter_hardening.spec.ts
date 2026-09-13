import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SessionController } from '../trading/session.controller';
import { SessionService } from '../trading/session.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PresetsController } from '../trading/presets.controller';
import { StrategyPreset } from '../models/entities/StrategyPreset.entity';
import { AuditLogService } from '../trading/audit-log.service';
import { CreateStrategyPresetDto } from '../trading/dto/strategy-preset.dto';
import { BacktestService, RunBacktestDto } from '../engine/backtest.service';
import { SmartOptimizerService, RunOptimizationDto } from '../engine/smart-optimizer.service';
import { ConfigService } from '@nestjs/config';
import { UpdateTradeConfigDto } from '../trading/dto/session.dto';

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

    it('should accept valid strategy_config overrides in updateTradeConfig', async () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const validBody = {
        strategy_config: {
          strategy_label: 'Custom Trade Overrides',
          sl_distance_pct: 1.5,
        },
      };
      await expect(controller.updateTradeConfig(validUuid, validBody as any, mockReq)).resolves.not.toThrow();
      expect(mockSessionService.updateTradeConfig).toHaveBeenCalled();
    });

    it('should reject non-whitelisted properties in strategy_config overrides in updateTradeConfig', async () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const invalidBody = {
        strategy_config: {
          strategy_label: 'Valid Label',
          unauthorized_extra_param: '<script>alert("xss")</script>',
        },
      };
      await expect(controller.updateTradeConfig(validUuid, invalidBody as any, mockReq)).rejects.toThrow(
        BadRequestException
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

  describe('updateSession Strategy Config Whitelist Validation', () => {
    it('should accept valid partial strategy configuration in updateSession', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      mockSessionService.updateSession = jest.fn().mockResolvedValue({ status: 'updated' });
      const validPayload = {
        config: {
          strategy_label: 'Updated Strategy Label',
          scan_interval: '5m',
        },
      };
      await expect(controller.updateSession(validUuid, validPayload as any, mockReq)).resolves.not.toThrow();
      expect(mockSessionService.updateSession).toHaveBeenCalled();
    });

    it('should reject non-whitelisted properties in updateSession strategy configuration', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      mockSessionService.updateSession = jest.fn().mockResolvedValue({ status: 'updated' });
      const invalidPayload = {
        config: {
          strategy_label: 'Updated Strategy Label',
          unauthorized_extra_param: '<script>alert("xss")</script>',
        },
      };
      await expect(controller.updateSession(validUuid, invalidPayload as any, mockReq)).rejects.toThrow(
        BadRequestException
      );
      expect(mockSessionService.updateSession).not.toHaveBeenCalled();
    });
  });

  describe('runSmartOptimization Base Strategy Config Whitelist Validation', () => {
    it('should accept valid base strategy configuration in runSmartOptimization', async () => {
      const validPayload = {
        baseConfig: {
          strategy_label: 'Smart Base Strategy',
          scan_interval: '5m',
        },
      };
      await expect(controller.runSmartOptimization(validPayload as any)).resolves.not.toThrow();
    });

    it('should reject non-whitelisted properties in runSmartOptimization base strategy configuration', async () => {
      const invalidPayload = {
        baseConfig: {
          strategy_label: 'Smart Base Strategy',
          unauthorized_extra_param: '<script>alert(1)</script>',
        },
      };
      await expect(controller.runSmartOptimization(invalidPayload as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject invalid property values in runSmartOptimization base strategy configuration', async () => {
      const invalidPayload = {
        baseConfig: {
          strategy_label: 'Invalid <script>alert(1)</script>',
        },
      };
      await expect(controller.runSmartOptimization(invalidPayload as any)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('UpdateTradeConfigDto Sequence Element Bounds and Price Validation', () => {
    it('should accept valid non-negative sequence elements <= 100 and valid current_sl', async () => {
      const dto = plainToInstance(UpdateTradeConfigDto, {
        current_sl: 50000,
        live_rr_sequence: [1.0, 2.5, 5.0],
        exit_rr_sequence: [0.0, 1.5, 3.0],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject current_sl exceeding 100,000,000 in UpdateTradeConfigDto', async () => {
      const dto = plainToInstance(UpdateTradeConfigDto, {
        current_sl: 100000001,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const slErr = errors.find((e) => e.property === 'current_sl');
      expect(slErr?.constraints?.max).toBeDefined();
    });

    it('should reject negative numbers in live_rr_sequence or exit_rr_sequence', async () => {
      const dto = plainToInstance(UpdateTradeConfigDto, {
        live_rr_sequence: [-1.0, 2.5],
        exit_rr_sequence: [0.0, -0.5],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const liveErr = errors.find((e) => e.property === 'live_rr_sequence');
      const exitErr = errors.find((e) => e.property === 'exit_rr_sequence');
      expect(liveErr?.constraints?.min).toBeDefined();
      expect(exitErr?.constraints?.min).toBeDefined();
    });

    it('should reject numbers exceeding 100 in live_rr_sequence or exit_rr_sequence', async () => {
      const dto = plainToInstance(UpdateTradeConfigDto, {
        live_rr_sequence: [100.5],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const liveErr = errors.find((e) => e.property === 'live_rr_sequence');
      expect(liveErr?.constraints?.max).toBeDefined();
    });
  });

  describe('PresetsController & CreateStrategyPresetDto Whitelist Validation', () => {
    let presetsController: PresetsController;
    let mockPresetRepository: any;

    beforeEach(async () => {
      mockPresetRepository = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation((dto) => Promise.resolve({ id: 'p1', ...dto })),
        remove: jest.fn().mockResolvedValue({ success: true }),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [PresetsController],
        providers: [
          {
            provide: getRepositoryToken(StrategyPreset),
            useValue: mockPresetRepository,
          },
          {
            provide: SessionService,
            useValue: mockSessionService,
          },
          {
            provide: AuditLogService,
            useValue: {
              log: jest.fn().mockResolvedValue({}),
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

      presetsController = module.get<PresetsController>(PresetsController);
    });

    it('should accept valid strategy preset payloads in savePreset', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const validPayload = {
        name: 'Conservative Scalp (15m)',
        config: {
          strategy_label: 'Conservative Scalp',
          scan_interval: '15m',
        },
      };

      await expect(presetsController.savePreset(validPayload as any, mockReq)).resolves.not.toThrow();
      expect(mockPresetRepository.save).toHaveBeenCalled();
    });

    it('should reject non-whitelisted top-level properties in savePreset', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const invalidPayload = {
        name: 'Valid Name',
        config: {
          strategy_label: 'Valid Strategy',
        },
        unauthorized_top_level_param: 'malicious payload',
      };

      await expect(presetsController.savePreset(invalidPayload as any, mockReq)).rejects.toThrow(
        BadRequestException
      );
      expect(mockPresetRepository.save).not.toHaveBeenCalled();
    });

    it('should reject invalid preset name containing HTML tags in savePreset', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const invalidPayload = {
        name: '<script>alert("XSS")</script>',
        config: {
          strategy_label: 'Valid Strategy',
        },
      };

      await expect(presetsController.savePreset(invalidPayload as any, mockReq)).rejects.toThrow(
        BadRequestException
      );
      expect(mockPresetRepository.save).not.toHaveBeenCalled();
    });

    it('should reject non-whitelisted properties in nested config in savePreset', async () => {
      const mockReq = { ip: '127.0.0.1', headers: {} } as any;
      const invalidPayload = {
        name: 'Valid Name',
        config: {
          strategy_label: 'Valid Strategy',
          unauthorized_extra_config: '<script>alert(1)</script>',
        },
      };

      await expect(presetsController.savePreset(invalidPayload as any, mockReq)).rejects.toThrow(
        BadRequestException
      );
      expect(mockPresetRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('RunBacktestDto & RunOptimizationDto Symbol Length Gating', () => {
    it('should accept valid symbol strings with length >= 3', async () => {
      const backtestDto = plainToInstance(RunBacktestDto, {
        symbols: ['BTCUSDT', 'ETHUSDT'],
      });
      const optDto = plainToInstance(RunOptimizationDto, {
        symbols: ['SOLUSDT', 'BNBUSDT'],
      });

      const backtestErrors = await validate(backtestDto);
      const optErrors = await validate(optDto);

      expect(backtestErrors.length).toBe(0);
      expect(optErrors.length).toBe(0);
    });

    it('should reject empty or sub-3 character symbols in symbols array', async () => {
      const backtestDto = plainToInstance(RunBacktestDto, {
        symbols: ['BT', ''],
      });
      const optDto = plainToInstance(RunOptimizationDto, {
        symbols: ['A', '12'],
      });

      const backtestErrors = await validate(backtestDto);
      const optErrors = await validate(optDto);

      expect(backtestErrors.length).toBeGreaterThan(0);
      expect(optErrors.length).toBeGreaterThan(0);

      const bErr = backtestErrors.find((e) => e.property === 'symbols');
      const oErr = optErrors.find((e) => e.property === 'symbols');

      expect(bErr?.constraints?.matches).toBeDefined();
      expect(oErr?.constraints?.matches).toBeDefined();
    });
  });
});
