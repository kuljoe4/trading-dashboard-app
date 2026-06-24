import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissingSettingsFields1781993000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "exchange_info_cache" jsonb`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "exchange_info_ts" bigint`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "taker_fee_rate" numeric(10,8) NOT NULL DEFAULT '0.0004'`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "taker_fee_ts" bigint`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "api_ban_until" bigint`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "api_ban_reason" varchar`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "is_one_way_mode" boolean`);
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "last_mode_sync" bigint`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "exchange_info_cache"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "exchange_info_ts"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "taker_fee_rate"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "taker_fee_ts"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "api_ban_until"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "api_ban_reason"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "is_one_way_mode"`);
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "last_mode_sync"`);
    }
}
