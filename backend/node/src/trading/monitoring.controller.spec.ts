import { Test, TestingModule } from '@nestjs/testing';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from '../engine/monitoring.service';
import { SessionStateService } from '../engine/session_state.service';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import * as throttle from '../lib/throttle';

describe('MonitoringController', () => {
  let controller: MonitoringController;
  let monitoringService: MonitoringService;
  let sessionStateService: SessionStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MonitoringController],
      providers: [
        {
          provide: MonitoringService,
          useValue: {
            getMetrics: jest.fn().mockReturnValue({
              application: { exchange_uds_status: 'CONNECTED' },
            }),
          },
        },
        {
          provide: SessionStateService,
          useValue: {
            getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 100, weight_limit: 2400 }),
            config: {},
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('dummy_key'),
          },
        },
        ApiKeyGuard,
      ],
    }).compile();

    controller = module.get<MonitoringController>(MonitoringController);
    monitoringService = module.get<MonitoringService>(MonitoringService);
    sessionStateService = module.get<SessionStateService>(SessionStateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return metrics for getStats', () => {
    expect(controller.getStats()).toBeDefined();
    expect(monitoringService.getMetrics).toHaveBeenCalled();
  });

  describe('healthz endpoints', () => {
    const mockRequest = (ip: string): Request => ({
      ip,
      headers: {},
      socket: { remoteAddress: ip },
    } as any);

    it('should throttle /healthz/liveness if rate limit is exceeded', () => {
      jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(true);
      expect(() => controller.getLiveness(mockRequest('127.0.0.1'))).toThrow(
        new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
      );
    });

    it('should return 200 OK for /healthz/liveness if not throttled', () => {
      jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(false);
      const res = controller.getLiveness(mockRequest('127.0.0.1'));
      expect(res.status).toBe('OK');
      expect(res.timestamp).toBeDefined();
    });

    it('should throttle /healthz/readiness if rate limit is exceeded', () => {
      jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(true);
      expect(() => controller.getReadiness(mockRequest('127.0.0.1'))).toThrow(
        new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
      );
    });

    it('should return READY for /healthz/readiness if not throttled and healthy', () => {
      jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(false);
      const res = controller.getReadiness(mockRequest('127.0.0.1'));
      expect(res.status).toBe('READY');
      expect(res.uds).toBe('CONNECTED');
    });
  });
});
