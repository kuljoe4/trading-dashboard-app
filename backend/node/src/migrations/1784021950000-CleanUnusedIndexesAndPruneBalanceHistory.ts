import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanUnusedIndexesAndPruneBalanceHistory1784021950000 implements MigrationInterface {
  name = 'CleanUnusedIndexesAndPruneBalanceHistory1784021950000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop redundant single-column indexes on balance_history
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_6b3c6a9d5ae64c7395d67207cb"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_balance_history_timestamp"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_balance_history_trading_mode"`);

    // 2. Create composite index on trade_entity("sessionId", "status") for high-frequency SUM(pnl) aggregations
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_TRADE_ENTITY_SESSION_STATUS" ON "trade_entity" ("sessionId", "status")`,
    );

    // 3. Prune stale balance_history rows older than 3 days to reclaim storage
    await queryRunner.query(`DELETE FROM "balance_history" WHERE "timestamp" < NOW() - INTERVAL '3 days'`);

    // 4. Attempt pg_stat_statements extension creation for database query statistics tracking
    try {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`);
    } catch {
      // Ignore if user lacks superuser permissions in restricted database environments
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_TRADE_ENTITY_SESSION_STATUS"`);
  }
}
