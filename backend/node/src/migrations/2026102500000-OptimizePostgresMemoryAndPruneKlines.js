export class OptimizePostgresMemoryAndPruneKlines2026102500000 {
    name = 'OptimizePostgresMemoryAndPruneKlines2026102500000';
    async up(queryRunner) {
        // 1. Drop redundant single-column indexes on klines table to save B-tree index memory
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_SYMBOL"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_INTERVAL"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_TIME"`);
        // 2. Prune stale 1m klines older than 24 hours to dramatically reduce table row count
        const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
        await queryRunner.query(`DELETE FROM "klines" WHERE "interval" = '1m' AND "time" < ${oneDayAgoMs}`);
        // 3. Prune stale log entries older than 2 days
        const twoDaysAgoIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        await queryRunner.query(`DELETE FROM "log" WHERE "ts" < '${twoDaysAgoIso}'`);
        // 4. Reclaim memory and refresh planner statistics
        try {
            await queryRunner.query(`ANALYZE klines; ANALYZE log; ANALYZE balance_history; ANALYZE audit_logs;`);
        }
        catch {
            // Ignore if non-standard environment
        }
    }
    async down(queryRunner) {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_KLINES_SYMBOL" ON "klines" ("symbol")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_KLINES_INTERVAL" ON "klines" ("interval")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_KLINES_TIME" ON "klines" ("time")`);
    }
}
