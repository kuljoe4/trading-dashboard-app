import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDebuggingFieldsToTrade1781992000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "mark_price" decimal(20,8)`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "last_price" decimal(20,8)`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_signals_status" jsonb`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_type" varchar`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_confidence" decimal(10,4) DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "last_close_attempt_ts" bigint`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "mark_price"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "last_price"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "exit_signals_status"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_type"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_confidence"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "last_close_attempt_ts"`);
    }
}
