import { MigrationInterface, QueryRunner } from "typeorm";

export class ShrinkPostgresMemoryAndUnloggedKlines2026111400000 implements MigrationInterface {
  name = "ShrinkPostgresMemoryAndUnloggedKlines2026111400000";
  // Run outside a transaction block so ALTER SYSTEM, VACUUM FULL, and CHECKPOINT can execute
  // and immediately unlink bloated heap/WAL files from the container's OS page cache.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Cap per-session memory during maintenance
    const sessionSettings = [
      `SET work_mem = '4MB'`,
      `SET maintenance_work_mem = '16MB'`,
      `SET temp_buffers = '4MB'`,
    ];
    for (const stmt of sessionSettings) {
      try {
        await queryRunner.query(stmt);
      } catch {
        // Ignore if unsupported
      }
    }

    // 2. Tune PostgreSQL server-level WAL & memory limits to prevent 1GB container page-cache growth on Railway
    const systemSettings = [
      `ALTER SYSTEM SET max_wal_size = '64MB'`,
      `ALTER SYSTEM SET min_wal_size = '16MB'`,
      `ALTER SYSTEM SET wal_keep_size = '0MB'`,
      `ALTER SYSTEM SET work_mem = '4MB'`,
      `ALTER SYSTEM SET maintenance_work_mem = '16MB'`,
      `ALTER SYSTEM SET autovacuum_work_mem = '16MB'`,
      `ALTER SYSTEM SET temp_buffers = '4MB'`,
      `ALTER SYSTEM SET wal_compression = 'on'`,
    ];
    for (const stmt of systemSettings) {
      try {
        await queryRunner.query(stmt);
      } catch {
        // Ignore if role lacks superuser/ALTER SYSTEM privileges
      }
    }
    try {
      await queryRunner.query(`SELECT pg_reload_conf()`);
    } catch {
      // Ignore if unsupported
    }

    // 3. Reclaim klines disk & OS page cache immediately via temp-table swap + TRUNCATE + UNLOGGED conversion
    const hasKlines = await queryRunner.hasTable("klines");
    if (hasKlines) {
      const dayMs = 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const cutoffShort = nowMs - 1 * dayMs;
      const cutoffMed = nowMs - 4 * dayMs;
      const cutoffHourly = nowMs - 10 * dayMs;
      const cutoff4h = nowMs - 35 * dayMs;
      const cutoffDaily = nowMs - 60 * dayMs;

      try {
        await queryRunner.query(`DROP TABLE IF EXISTS "_klines_warm_keep"`);
        await queryRunner.query(`
          CREATE TEMP TABLE "_klines_warm_keep" AS
          SELECT "id", "symbol", "interval", "time", "open", "high", "low", "close", "volume"
          FROM (
            SELECT
              "id", "symbol", "interval", "time", "open", "high", "low", "close", "volume",
              ROW_NUMBER() OVER (PARTITION BY "symbol", "interval" ORDER BY "time" DESC) AS rn
            FROM "klines"
            WHERE "interval" <> '1m'
              AND (
                ("interval" IN ('3m', '5m') AND "time" >= ${cutoffShort}) OR
                ("interval" IN ('15m', '30m') AND "time" >= ${cutoffMed}) OR
                ("interval" IN ('1h', '2h') AND "time" >= ${cutoffHourly}) OR
                ("interval" IN ('4h', '6h', '8h', '12h') AND "time" >= ${cutoff4h}) OR
                ("interval" NOT IN ('1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h') AND "time" >= ${cutoffDaily})
              )
          ) ranked
          WHERE ranked.rn <= 150
        `);

        // TRUNCATE immediately unlinks the multi-hundred-MB table heap and index files from disk,
        // forcing the Linux kernel in Docker/Railway to evict 100% of their OS page cache immediately.
        await queryRunner.query(`TRUNCATE TABLE "klines"`);

        // Convert klines to UNLOGGED so future candle cache writes generate zero WAL (pg_wal) bloat
        try {
          await queryRunner.query(`ALTER TABLE "klines" SET UNLOGGED`);
        } catch {
          // Ignore if already unlogged or unsupported
        }

        await queryRunner.query(`
          INSERT INTO "klines" ("id", "symbol", "interval", "time", "open", "high", "low", "close", "volume")
          SELECT "id", "symbol", "interval", "time", "open", "high", "low", "close", "volume"
          FROM "_klines_warm_keep"
          ON CONFLICT ("id") DO NOTHING
        `);
        await queryRunner.query(`DROP TABLE IF EXISTS "_klines_warm_keep"`);
      } catch {
        // Fallback if temp table swap fails
        try {
          await queryRunner.query(`DROP TABLE IF EXISTS "_klines_warm_keep"`);
        } catch {}
      }

      // Add compact (interval, time) index so periodic interval-based cleanup uses an Index Scan instead of Seq Scan
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_INTERVAL"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_TIME"`);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_KLINES_INTERVAL_TIME" ON "klines" ("interval", "time")`,
      );
    }

    // 4. Prune expired log and balance_history rows and compact their heap files
    const hasLog = await queryRunner.hasTable("log");
    if (hasLog) {
      const logCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await queryRunner.query(`DELETE FROM "log" WHERE "ts" < $1`, [logCutoff]);
        await queryRunner.query(`VACUUM FULL ANALYZE "log"`);
      } catch {}
    }

    const hasBalanceHistory = await queryRunner.hasTable("balance_history");
    if (hasBalanceHistory) {
      const balanceCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await queryRunner.query(`DELETE FROM "balance_history" WHERE "timestamp" < $1`, [balanceCutoff]);
        await queryRunner.query(`VACUUM FULL ANALYZE "balance_history"`);
      } catch {}
    }

    // 5. Force a CHECKPOINT so PostgreSQL immediately recycles/unlinks old 16MB WAL segment files in pg_wal/
    try {
      await queryRunner.query(`CHECKPOINT`);
    } catch {
      // Ignore if role lacks CHECKPOINT permission
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasKlines = await queryRunner.hasTable("klines");
    if (hasKlines) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_KLINES_INTERVAL_TIME"`);
      try {
        await queryRunner.query(`ALTER TABLE "klines" SET LOGGED`);
      } catch {}
    }
  }
}
