import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from '../engine/monitoring.service';
import { SessionStateService } from '../engine/session_state.service';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as throttle from '../lib/throttle';
import { encrypt } from '../lib/crypto';
describe('MonitoringController', () => {
    let controller;
    let monitoringService;
    let sessionStateService;
    let settingsRepository;
    let originalApiKey;
    beforeEach(async () => {
        originalApiKey = process.env.ADMIN_API_KEY;
        process.env.ADMIN_API_KEY = 'test_key';
        const module = await Test.createTestingModule({
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
                        isBanned: jest.fn().mockReturnValue(false),
                        apiStatus: { isBanned: false, isRateLimited: false, banUntil: null, lastErrorMessage: null },
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn().mockReturnValue('dummy_key'),
                    },
                },
                {
                    provide: getRepositoryToken(SettingsEntity),
                    useValue: {
                        findOne: jest.fn().mockResolvedValue(null),
                        query: jest.fn().mockResolvedValue([{ 1: 1 }]),
                    },
                },
                ApiKeyGuard,
            ],
        }).compile();
        controller = module.get(MonitoringController);
        monitoringService = module.get(MonitoringService);
        sessionStateService = module.get(SessionStateService);
        settingsRepository = module.get(getRepositoryToken(SettingsEntity));
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    afterEach(() => {
        if (originalApiKey !== undefined) {
            process.env.ADMIN_API_KEY = originalApiKey;
        }
        else {
            delete process.env.ADMIN_API_KEY;
        }
    });
    it('should return metrics for getStats', () => {
        expect(controller.getStats()).toBeDefined();
        expect(monitoringService.getMetrics).toHaveBeenCalled();
    });
    it('should return service operational info for getRoot (GET /)', async () => {
        const root = await controller.getRoot({});
        expect(root.status).toBe('online');
        expect(root.service).toBe('backend');
        expect(root.endpoints.health).toBe('/health');
        expect(root.endpoints.websocket).toBe('/session/ws');
    });
    describe('healthz endpoints', () => {
        const mockRequest = (ip) => ({
            ip,
            headers: {},
            socket: { remoteAddress: ip },
        });
        it('should throttle /healthz/liveness if rate limit is exceeded', () => {
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(true);
            expect(() => controller.getLiveness(mockRequest('127.0.0.1'))).toThrow(new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS));
        });
        it('should return 200 OK for /healthz/liveness if not throttled', () => {
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(false);
            const res = controller.getLiveness(mockRequest('127.0.0.1'));
            expect(res.status).toBe('OK');
            expect(res.timestamp).toBeDefined();
        });
        it('should throttle /healthz/readiness if rate limit is exceeded', () => {
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(true);
            expect(() => controller.getReadiness(mockRequest('127.0.0.1'))).toThrow(new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS));
        });
        it('should return READY for /healthz/readiness if not throttled and healthy', () => {
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(false);
            const res = controller.getReadiness(mockRequest('127.0.0.1'));
            expect(res.status).toBe('READY');
            expect(res.uds).toBe('CONNECTED');
        });
        it('should throttle /healthz/binance if rate limit is exceeded', async () => {
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValueOnce(true);
            await expect(controller.getBinanceHealth(mockRequest('127.0.0.1'))).rejects.toThrow(new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS));
        });
        it('should return healthy connection status when Binance endpoints respond with 200', async () => {
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValue(false);
            jest.spyOn(controller, 'probeBinanceEndpoint').mockImplementation(async (url) => ({
                url,
                accessible: true,
                status_code: 200,
                latency_ms: 35,
                geo_restricted: false,
                ip_banned: false,
                rate_limited: false,
                error: null,
            }));
            const res = await controller.getBinanceHealth(mockRequest('127.0.0.1'));
            expect(res.status).toBe('ok');
            expect(res.geo_restricted).toBe(false);
            expect(res.live.accessible).toBe(true);
            expect(res.testnet.accessible).toBe(true);
            expect(res.diagnostics.some(d => d.includes('Binance Live Futures API is reachable'))).toBe(true);
        });
        it('should diagnose geo-restriction when Binance returns HTTP 451 or 403', async () => {
            process.env.ADMIN_API_KEY = 'test_key';
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValue(false);
            // Force fresh check to bypass cache
            const freshRequest = { ...mockRequest('127.0.0.1'), query: { fresh: 'true' }, headers: { 'x-api-key': 'test_key' } };
            jest.spyOn(controller, 'probeBinanceEndpoint').mockImplementation(async (url) => {
                if (url.includes('fapi.binance.com')) {
                    return {
                        url,
                        accessible: false,
                        status_code: 451,
                        latency_ms: 25,
                        geo_restricted: true,
                        ip_banned: false,
                        rate_limited: false,
                        error: 'HTTP 451: Service unavailable from a restricted location',
                    };
                }
                return {
                    url,
                    accessible: true,
                    status_code: 200,
                    latency_ms: 50,
                    geo_restricted: false,
                    ip_banned: false,
                    rate_limited: false,
                    error: null,
                };
            });
            const res = await controller.getBinanceHealth(freshRequest);
            expect(res.status).toBe('restricted');
            expect(res.geo_restricted).toBe(true);
            expect(res.live.geo_restricted).toBe(true);
            expect(res.diagnostics.some(d => d.includes('Geo-restriction detected'))).toBe(true);
            expect(res.diagnostics.some(d => d.includes('Configure a Proxy URL'))).toBe(true);
            expect(res.diagnostics.some(d => d.includes('Testnet API is reachable'))).toBe(true);
        });
        it('should return cached result when within cache TTL', async () => {
            process.env.ADMIN_API_KEY = 'test_key';
            jest.spyOn(throttle, 'isGeneralRateLimited').mockReturnValue(false);
            const probeSpy = jest.spyOn(controller, 'probeBinanceEndpoint').mockImplementation(async (url) => ({
                url,
                accessible: true,
                status_code: 200,
                latency_ms: 40,
                geo_restricted: false,
                ip_banned: false,
                rate_limited: false,
                error: null,
            }));
            // First call (populates cache)
            const res1 = await controller.getBinanceHealth({ ...mockRequest('127.0.0.1'), query: { fresh: 'true' }, headers: { 'x-api-key': 'test_key' } });
            expect(res1.cached).toBe(false);
            expect(probeSpy).toHaveBeenCalledTimes(2); // live + testnet
            // Second call (hits cache)
            const res2 = await controller.getBinanceHealth({ ...mockRequest('127.0.0.1'), query: {}, headers: { authorization: 'Bearer test_key' } });
            expect(res2.cached).toBe(true);
            expect(probeSpy).toHaveBeenCalledTimes(2); // no additional calls
        });
    });
    describe('getStartupChecklist', () => {
        const mockRequest = (ip) => ({
            ip,
            headers: {},
            socket: { remoteAddress: ip },
        });
        it('should detect API keys saved in settings database when process.env.BINANCE_API_KEY is unset', async () => {
            const originalEnvKey = process.env.BINANCE_API_KEY;
            delete process.env.BINANCE_API_KEY;
            process.env.ENCRYPTION_KEY = 'test_encryption_key_123456';
            const fakeEncryptedKey = encrypt('live_api_key_1234567890_abcdef');
            settingsRepository.findOne.mockResolvedValueOnce({
                id: 'default',
                binance_api_key: fakeEncryptedKey,
                binance_testnet_api_key: null,
            });
            jest.spyOn(controller, 'probeBinanceEndpoint').mockImplementation(async (url) => ({
                url,
                accessible: true,
                status_code: 200,
                latency_ms: 30,
                geo_restricted: false,
                ip_banned: false,
                rate_limited: false,
                error: null,
            }));
            const res = await controller.getStartupChecklist(mockRequest('127.0.0.1'));
            const keyCheck = res.checks.find((c) => c.id === 'binance_live_keys');
            expect(keyCheck).toBeDefined();
            expect(keyCheck.status).toBe('PASS');
            expect(keyCheck.summary).toContain('Configured (••••••••cdef)');
            expect(keyCheck.detail).toContain('Settings database');
            if (originalEnvKey !== undefined) {
                process.env.BINANCE_API_KEY = originalEnvKey;
            }
        });
    });
});
