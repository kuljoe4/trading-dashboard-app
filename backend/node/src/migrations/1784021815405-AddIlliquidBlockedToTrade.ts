import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIlliquidBlockedToTrade1784021815405 implements MigrationInterface {
    name = 'AddIlliquidBlockedToTrade1784021815405'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "illiquid_blocked" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "illiquid_blocked"`);
    }
}
