const n_trades = 200;

function runAnalyticBenchmark() {
    console.log(`Simulating analytic benchmark with ${n_trades} trades...`);
    const dbLatencyMs = 2; // Assume 2ms per query to the DB

    const baselineTime = n_trades * dbLatencyMs;
    console.log(`Baseline (N+1 queries) estimated time: ${baselineTime}ms`);

    const optimizedTime = dbLatencyMs; // 1 query for all sessions using IN clause
    console.log(`Optimized (In clause) estimated time: ${optimizedTime}ms`);

    const speedup = baselineTime / optimizedTime;
    console.log(`Speedup: ${speedup}x`);
}

runAnalyticBenchmark();
