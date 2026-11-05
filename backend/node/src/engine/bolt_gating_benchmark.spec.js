import { GatingService } from './gating.service';
describe('GatingService Benchmark', () => {
    let gatingService;
    beforeEach(() => {
        // We don't need real dependencies for isInsideTradingWindow
        gatingService = new GatingService(null, null, null, null, null, null, null);
    });
    it('benchmark: isInsideTradingWindow', () => {
        const config = {
            trading_windows: [
                { start: '08:00', end: '12:00' },
                { start: '14:00', end: '18:00' },
                { start: '22:00', end: '02:00' },
            ]
        };
        const iterations = 1000000;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            gatingService.isInsideTradingWindow(config);
        }
        const end = performance.now();
        console.log(`[BENCHMARK] isInsideTradingWindow ${iterations} calls: ${(end - start).toFixed(2)}ms`);
        console.log(`[BENCHMARK] Time per call: ${((end - start) / iterations * 1000000).toFixed(4)}ns`);
    });
});
