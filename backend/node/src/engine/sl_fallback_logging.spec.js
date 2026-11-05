import { RiskEngineService } from './riskEngine';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
describe('SL Strategy Process & Fallback Decision Logging Suite', () => {
    let riskEngine;
    let eventEmitter;
    let emittedLogs;
    beforeEach(() => {
        eventEmitter = new EventEmitter2();
        emittedLogs = [];
        eventEmitter.on(ENGINE_EVENTS.LOG_MESSAGE, (payload) => {
            emittedLogs.push(payload);
        });
        riskEngine = new RiskEngineService(eventEmitter);
    });
    describe('Supertrend SL Fallbacks', () => {
        it('should log fallback to Decision Log when Supertrend SL is undefined', () => {
            const config = {
                sl_type: 'supertrend',
                sl_distance_pct: 1.5,
            };
            const result = riskEngine.computeSl(100, 'LONG', config, undefined, undefined, 'BTCUSDT', undefined, undefined, undefined, undefined, undefined // supertrendSlPrice missing
            );
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackReason).toContain('[SL Strategy Fallback] BTCUSDT: Supertrend stop-loss price unavailable or invalid');
            expect(result.slPrice).toBe(98.5); // 1.5% below 100
            expect(emittedLogs.length).toBeGreaterThan(0);
            expect(emittedLogs[0].msg).toContain('[SL Strategy Fallback] BTCUSDT: Supertrend stop-loss price unavailable');
            expect(emittedLogs[0].level).toBe('warn');
        });
        it('should log fallback to Decision Log when Supertrend SL is non-positive or NaN', () => {
            const config = {
                sl_type: 'supertrend',
                sl_distance_pct: 1.0,
            };
            const result = riskEngine.computeSl(100, 'SHORT', config, undefined, undefined, 'ETHUSDT', undefined, undefined, undefined, undefined, -5 // Invalid supertrendSlPrice
            );
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackReason).toContain('[SL Strategy Fallback] ETHUSDT: Supertrend stop-loss price unavailable or invalid');
            expect(result.slPrice).toBe(101.0); // 1.0% above 100 for SHORT
            expect(emittedLogs).toContainEqual({
                msg: expect.stringContaining('[SL Strategy Fallback] ETHUSDT: Supertrend stop-loss price unavailable or invalid'),
                level: 'warn',
            });
        });
    });
    describe('Lookback Extremes Fallbacks', () => {
        it('should log fallback to Decision Log when Lookback extremes are missing and MACD PBC is unavailable', () => {
            const config = {
                sl_type: 'lookback_low/high',
                sl_distance_pct: 2.0,
            };
            const result = riskEngine.computeSl(100, 'LONG', config, undefined, // minLow missing
            undefined, // maxHigh missing
            'SOLUSDT');
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackReason).toContain('[SL Strategy Fallback] SOLUSDT: Lookback extremes unavailable');
            expect(result.slPrice).toBe(98.0); // 2.0% below 100
            expect(emittedLogs).toContainEqual({
                msg: expect.stringContaining('[SL Strategy Fallback] SOLUSDT: Lookback extremes unavailable (minLow: undefined, maxHigh: undefined)'),
                level: 'warn',
            });
        });
    });
    describe('Engulfing Boundary Fallbacks', () => {
        it('should log fallback to Decision Log when Engulfing structural boundaries are missing', () => {
            const config = {
                sl_type: 'engulfing_boundary',
                sl_distance_pct: 1.2,
            };
            const result = riskEngine.computeSl(100, 'LONG', config, undefined, undefined, 'AVAXUSDT', undefined, // patternLow missing
            undefined // patternHigh missing
            );
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackReason).toContain('[SL Strategy Fallback] AVAXUSDT: Engulfing boundary unavailable');
            expect(result.slPrice).toBe(98.8); // 1.2% below 100
            expect(emittedLogs).toContainEqual({
                msg: expect.stringContaining('[SL Strategy Fallback] AVAXUSDT: Engulfing boundary unavailable (engulfing_boundary)'),
                level: 'warn',
            });
        });
    });
    describe('Trailing SL Type Defaulting', () => {
        it('should log fallback to Decision Log when trailing sl_type is selected', () => {
            const config = {
                sl_type: 'trailing',
                sl_distance_pct: 0.8,
            };
            const result = riskEngine.computeSl(100, 'LONG', config, undefined, undefined, 'BNBUSDT');
            expect(result.fallbackUsed).toBe(true);
            expect(result.fallbackReason).toContain('[SL Strategy Fallback] BNBUSDT: Trailing SL type selected, defaulting to Pct SL');
            expect(result.slPrice).toBe(99.2);
            expect(emittedLogs).toContainEqual({
                msg: expect.stringContaining('[SL Strategy Fallback] BNBUSDT: Trailing SL type selected, defaulting to Pct SL'),
                level: 'info',
            });
        });
    });
});
