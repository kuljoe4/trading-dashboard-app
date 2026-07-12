import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

describe('SessionController', () => {
  let controller: SessionController;
  let sessionService: SessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: SessionService,
          useValue: {
            getTrade: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-key'),
          },
        },
        {
          provide: 'AuditLogService',
          useValue: {},
        }
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
    sessionService = module.get<SessionService>(SessionService);
  });

  describe('getTrade', () => {
    it('should allow valid UUID', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      await controller.getTrade(uuid);
      expect(sessionService.getTrade).toHaveBeenCalledWith(uuid);
    });

    it('should allow UUID v7', async () => {
      const uuidV7 = '018f4a0a-6e3e-72c3-8e1a-56789abcdef0';
      await controller.getTrade(uuidV7);
      expect(sessionService.getTrade).toHaveBeenCalledWith(uuidV7);
    });

    it('should allow valid Binance symbol', async () => {
      const symbol = 'BTCUSDT';
      await controller.getTrade(symbol);
      expect(sessionService.getTrade).toHaveBeenCalledWith(symbol);
    });

    it('should throw BadRequestException for invalid format', async () => {
      const invalid = 'invalid_format!';
      await expect(controller.getTrade(invalid)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for overly long input', async () => {
      const longInput = 'A'.repeat(50);
      await expect(controller.getTrade(longInput)).rejects.toThrow(BadRequestException);
    });
  });
});
