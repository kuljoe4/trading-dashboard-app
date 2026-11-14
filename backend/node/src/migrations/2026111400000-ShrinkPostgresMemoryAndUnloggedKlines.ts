import { MigrationInterface, QueryRunner } from "typeorm";

export class ShrinkPostgresMemoryAndUnloggedKlines2026111400000 implements MigrationInterface {
  name = "ShrinkPostgresMemoryAndUnloggedKlines2026111400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Cap per-session memory during maintenance
    const sessionSettings = [
      `SET LOCAL work_mem = '4MB'`,
      `SET LOCAL maintenance_work_mem = '16MB'`,
      `SET LOCAL temp_buffers = '4MB'`,
    ];
    for (const stmt of sessionSettings) {
      try {
        await queryRunner.query(stmt);
      } catch {
        // Ignore if unsupported
      }
    }

    // 2. Reclaim klines disk & OS page cache immediately via temp-table swap + TRUNCATE + UNLOGGED conversion
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

    // 3. Prune expired log and balance_history rows
    const hasLog = await queryRunner.hasTable("log");
    if (hasLog) {
      const logCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await queryRunner.query(`DELETE FROM "log" WHERE "ts" < $1`, [logCutoff]);
      } catch {}
    }

    const hasBalanceHistory = await queryRunner.hasTable("balance_history");
    if (hasBalanceHistory) {
      const balanceCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await queryRunner.query(`DELETE FROM "balance_history" WHERE "timestamp" < $1`, [balanceCutoff]);
      } catch {}
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
