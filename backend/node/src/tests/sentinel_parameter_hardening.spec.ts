import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SessionController } from '../trading/session.controller';
import { SessionService } from '../trading/session.service';
import { ConfigService } from '@nestjs/config';

describe('Sentinel: Parameter and Query Input Hardening', () => {
  let controller: SessionController;
  let mockSessionService: any;

  beforeEach(async () => {
    mockSessionService = {
      getTrade: jest.fn().mockResolvedValue({ id: 'valid-trade-id' }),
      updateTradeConfig: jest.fn().mockResolvedValue({ status: 'updated' }),
      getHistory: jest.fn().mockResolvedValue([]),
      closeTradeManually: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
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
});
