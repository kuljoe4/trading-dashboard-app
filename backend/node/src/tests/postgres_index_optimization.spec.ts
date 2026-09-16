import { OptimizePostgresIndexes1784021940000 } from '../migrations/1784021940000-OptimizePostgresIndexes';

describe('PostgreSQL Index Optimization Migration Test', () => {
  it('executes UP migration queries correctly', async () => {
    const migration = new OptimizePostgresIndexes1784021940000();
    const mockQueryRunner: any = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.up(mockQueryRunner);

    // Verify dropping unused candidate indexes
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_KLINES_SYMBOL"');
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_trade_entity_updated_at"');
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_audit_logs_resourceId"');
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_audit_logs_action"');

    // Verify dropping abandoned legacy tables
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS "settings_old"');
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS "log_old"');
    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS "balance_history_old"');

    // Verify composite index creation
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "IDX_BALANCE_HISTORY_SESSION_TIMESTAMP" ON "balance_history" ("sessionId", "timestamp")',
    );
  });

  it('executes DOWN migration queries correctly', async () => {
    const migration = new OptimizePostgresIndexes1784021940000();
    const mockQueryRunner: any = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.down(mockQueryRunner);

    expect(mockQueryRunner.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "IDX_BALANCE_HISTORY_SESSION_TIMESTAMP"');
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")',
    );
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "IDX_audit_logs_resourceId" ON "audit_logs" ("resourceId")',
    );
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "IDX_trade_entity_updated_at" ON "trade_entity" ("updated_at")',
    );
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "IDX_KLINES_SYMBOL" ON "klines" ("symbol")',
    );
  });
});
