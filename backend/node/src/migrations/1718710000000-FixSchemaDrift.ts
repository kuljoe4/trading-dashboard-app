import { MigrationInterface, QueryRunner } from "typeorm";

export class FixSchemaDrift1718710000000 implements MigrationInterface {
    name = 'FixSchemaDrift1718710000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Essential columns often missing due to partial migrations or manual schema changes
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "risk_usdt" numeric(20,8) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "initial_risk_usdt" numeric(20,8)`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_signal_type" character varying`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_signal_reason" character varying`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "max_rr_achieved" numeric(20,8) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "rr_sequence_index" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "binance_stop_order_type" character varying`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_daily_change_pct" numeric(10,4)`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "is_reconciliation" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`);

        // Ensure constraints and indexes if they were missed
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_trade_entity_updated_at" ON "trade_entity" ("updated_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trade_entity_updated_at"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "updated_at"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "is_reconciliation"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_daily_change_pct"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "binance_stop_order_type"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "rr_sequence_index"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "max_rr_achieved"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "exit_signal_reason"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "exit_signal_type"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "initial_risk_usdt"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "risk_usdt"`);
    }
}
