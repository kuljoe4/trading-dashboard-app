import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsKnifeToTrade2026101300000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "is_knife" boolean DEFAULT false');
        await queryRunner.query('ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "is_martingale" boolean DEFAULT false');
        await queryRunner.query('ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "martingale_multiplier" decimal(10,4)');
        await queryRunner.query('ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "martingale_step" integer');
        await queryRunner.query('ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "martingale_threshold_reset" boolean DEFAULT false');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "is_knife"');
        await queryRunner.query('ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "is_martingale"');
        await queryRunner.query('ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "martingale_multiplier"');
        await queryRunner.query('ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "martingale_step"');
        await queryRunner.query('ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "martingale_threshold_reset"');
    }
}
