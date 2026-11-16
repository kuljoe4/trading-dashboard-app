import { BinanceRequestQueue } from './binanceClientFactory';
describe('BinanceRequestQueue Shared State', () => {
    let logger;
    let eventEmitter;
    let settingsRepository;
    let sessionState;
    beforeEach(() => {
        logger = {
            debug: jest.fn(),
            error: jest.fn(),
            fatal: jest.fn(),
            log: jest.fn(),
            verbose: jest.fn(),
            warn: jest.fn(),
        };
        eventEmitter = {
            emit: jest.fn(),
        };
        settingsRepository = {
            update: jest.fn().mockResolvedValue({}),
        };
        sessionState = {
            binanceOrderLimit: {
                used_10s: 0,
                limit_10s: 100,
                used_1m: 0,
                limit_1m: 1000
            }
        };
        // Reset static members cleanly between tests
        BinanceRequestQueue.setCooldownUntil(0);
        BinanceRequestQueue.setWeightLimit(2400);
        BinanceRequestQueue.lastRequestTs = 0;
        BinanceRequestQueue.currentWeight1m = 0;
        BinanceRequestQueue.adaptiveDelayMs = 0;
    });
    it('should share state between multiple instances', async () => {
        const queue1 = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        const queue2 = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        const headers = {
            get: (name) => (name === 'X-MBX-USED-WEIGHT-1M' ? '2000' : null),
        };
        queue1.updateWeightFromHeaders(headers);
        // Expect queue2 to see the updated state through static members
        expect(BinanceRequestQueue.currentWeight1m).toBe(2000);
        // SRE Update: 2000/2400 = 0.83 (> 0.75) => 1000ms delay
        expect(BinanceRequestQueue.adaptiveDelayMs).toBe(1000);
    });
    it('should log structured telemetry on execution', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        const successFn = jest.fn().mockResolvedValue('ok');
        await queue.add(successFn, 'test-success');
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Dispatching: test-success'));
        // SRE: High-Fidelity Structured Telemetry Logging uses standardized [Telemetry] format
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[Telemetry] test-success executed'));
    });
    it('should shed load (reject) non-critical calls when weight is > 75%', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        // Set weight to 80% (1920/2400)
        const headers = { get: (name) => (name === 'X-MBX-USED-WEIGHT-1M' ? '2000' : null) };
        queue.updateWeightFromHeaders(headers);
        const nonCriticalFn = jest.fn().mockResolvedValue('ok');
        const criticalFn = jest.fn().mockResolvedValue('ok');
        // Non-critical should be rejected
        await expect(queue.add(nonCriticalFn, 'ticker24hrPriceChangeStatistics')).rejects.toThrow('Load shedding active');
        // Critical should proceed
        await expect(queue.add(criticalFn, 'newOrder')).resolves.toBe('ok');
    });
    it('should enter safe cooldown and emit event on IP ban (418)', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        // RESEARCH: Verify that we NO LONGER call process.exit(1)
        let exitCalled = false;
        const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
            exitCalled = true;
            return undefined;
        });
        const failingFn = async () => {
            const err = new Error('IP banned (418)');
            throw err;
        };
        try {
            await queue.add(failingFn, 'test-ban');
        }
        catch (e) {
            // expected error from failingFn
        }
        expect(logger.fatal).toHaveBeenCalledWith(expect.stringContaining('BAN status (IP banned (418))'));
        expect(exitCalled).toBe(false);
        expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_reached', expect.objectContaining({
            type: 'BAN'
        }));
        // Verify cooldown is set (10 minutes = 600,000ms)
        const lastRequest = BinanceRequestQueue.lastRequestTs;
        expect(lastRequest).toBeGreaterThan(Date.now() + 500000);
        mockExit.mockRestore();
    });
    it('should emit recovery event when ban cooldown expires', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        // 1. Manually trigger a ban state
        BinanceRequestQueue.lastRequestTs = Date.now() + 5000;
        BinanceRequestQueue.currentWeight1m = 9999;
        BinanceRequestQueue.windowStartTs = Date.now() - 65000; // Force rollover eligibility
        // 2. Mock time to just after the cooldown
        const now = Date.now() + 6000;
        // 3. Trigger rollover
        queue.executeRollover(now);
        // 4. Verify recovery event
        expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_cleared');
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Terminal Lock lifted'));
    });
    it('should preserve active banCooldownUntil across emergency calls while rejecting non-emergency requests', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        const futureBan = Date.now() + 60 * 60 * 1000; // 1h ban
        BinanceRequestQueue.setCooldownUntil(futureBan);
        BinanceRequestQueue.currentWeight1m = 9999;
        const emergencyFn = jest.fn().mockResolvedValue('uds-ok');
        const normalFn = jest.fn().mockResolvedValue('should-not-run');
        await expect(queue.add(emergencyFn, 'keepaliveUserDataStream', true)).resolves.toBe('uds-ok');
        expect(emergencyFn).toHaveBeenCalledTimes(1);
        // Ban cooldown must still be intact after emergency call completed
        await expect(queue.add(normalFn, 'klineCandlestickData')).rejects.toThrow('IP banned');
        expect(normalFn).not.toHaveBeenCalled();
    });
    it('should enforce tiered ceilings for bulk audits (65%), active warmup klines (65%), background klines (50%), and operational queries (80%)', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        // Weight at 55% (1320/2400) -> background kline shed (>50%), active_warmup allowed (<65%)
        BinanceRequestQueue.currentWeight1m = 1320;
        await expect(queue.add(jest.fn().mockResolvedValue('bg'), 'klineCandlestickData', false, { estimatedWeight: 2 })).rejects.toThrow('Load shedding active');
        await expect(queue.add(jest.fn().mockResolvedValue('warmup'), 'klineCandlestickData', false, { priority: 'active_warmup', estimatedWeight: 1 })).resolves.toBe('warmup');
        // Weight at 68% (1632/2400) -> bulk audit (40w) & active_warmup shed (>65%), operational query allowed (<80%)
        BinanceRequestQueue.currentWeight1m = 1632;
        await expect(queue.add(jest.fn().mockResolvedValue([]), 'currentAllOpenOrders', false, { isBulk: true, estimatedWeight: 40 })).rejects.toThrow('Load shedding active');
        await expect(queue.add(jest.fn().mockResolvedValue('wu'), 'klineCandlestickData', false, { priority: 'active_warmup', estimatedWeight: 1 })).rejects.toThrow('Load shedding active');
        await expect(queue.add(jest.fn().mockResolvedValue([]), 'queryOrder', false, { estimatedWeight: 1 })).resolves.toEqual([]);
        // Weight at 82% (1968/2400) -> operational queries shed (>80%), critical entries still allowed (<95%)
        BinanceRequestQueue.currentWeight1m = 1968;
        await expect(queue.add(jest.fn().mockResolvedValue([]), 'queryOrder', false, { estimatedWeight: 1 })).rejects.toThrow('Load shedding active');
        await expect(queue.add(jest.fn().mockResolvedValue({ orderId: 1 }), 'newOrder')).resolves.toEqual({ orderId: 1 });
    });
    it('should detect Axios-wrapped 418 / -1003 ban errors with retry-after headers', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        const axiosBanError = new Error('Request failed');
        axiosBanError.response = {
            status: 418,
            data: { code: -1003, msg: 'Way too many requests; IP banned until ' + (Date.now() + 120000) },
            headers: { 'retry-after': '120' },
        };
        await expect(queue.add(() => Promise.reject(axiosBanError), 'klineCandlestickData')).rejects.toThrow('Request failed');
        expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_reached', expect.objectContaining({ type: 'BAN' }));
        expect(BinanceRequestQueue.currentWeight1m).toBe(9999);
    });
    it('should classify -1003 "Too many requests; current limit ... is 2400 requests per minute" (429) as a 60s RATE_LIMIT instead of a 24h BAN', async () => {
        const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
        const rateLimitError = new Error('Too many requests; current limit of IP(152.55.188.46) is 2400 requests per minute. Please use the websocket for live updates to avoid polling the API.');
        rateLimitError.response = {
            status: 429,
            data: {
                code: -1003,
                msg: 'Too many requests; current limit of IP(152.55.188.46) is 2400 requests per minute. Please use the websocket for live updates to avoid polling the API.',
            },
        };
        const before = Date.now();
        await expect(queue.add(() => Promise.reject(rateLimitError), 'klineCandlestickData')).rejects.toThrow('Too many requests');
        expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_reached', expect.objectContaining({
            type: 'RATE_LIMIT',
        }));
        const until = BinanceRequestQueue.getEffectiveCooldownUntil();
        // Should be ~60s (1-minute window reset), never 24h
        expect(until).toBeGreaterThanOrEqual(before + 55000);
        expect(until).toBeLessThanOrEqual(before + 70000);
    });
});
