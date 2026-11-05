export class OptimizePostgresIndexes1784021940000 {
    name = 'OptimizePostgresIndexes1784021940000';
    async up(queryRunner) {
        // 1. Drop unused candidate indexes to reclaim RAM & storage bloat
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_SYMBOL"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trade_entity_updated_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_resourceId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action"`);
        // 2. Drop abandoned legacy tables created by historical migrations
        await queryRunner.query(`DROP TABLE IF EXISTS "settings_old"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "log_old"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "balance_history_old"`);
        // 3. Create composite index on balance_history to eliminate 826+ sequential scans
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_BALANCE_HISTORY_SESSION_TIMESTAMP" ON "balance_history" ("sessionId", "timestamp")`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BALANCE_HISTORY_SESSION_TIMESTAMP"`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_resourceId" ON "audit_logs" ("resourceId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_trade_entity_updated_at" ON "trade_entity" ("updated_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_KLINES_SYMBOL" ON "klines" ("symbol")`);
    }
}
