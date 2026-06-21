import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissingPersistenceFieldsToTrade1718715000000 implements MigrationInterface {
    name = 'AddMissingPersistenceFieldsToTrade1718715000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "mark_price" numeric(20,8)`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "last_price" numeric(20,8)`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_signals_status" jsonb`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_type" character varying`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_confidence" numeric(20,8) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "close_attempts" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "last_close_attempt_ts" bigint`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "close_blocked" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "close_blocked"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "last_close_attempt_ts"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "close_attempts"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_confidence"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_type"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "exit_signals_status"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "last_price"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "mark_price"`);
    }
}
