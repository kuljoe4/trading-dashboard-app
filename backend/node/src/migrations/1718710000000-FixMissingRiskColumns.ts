import { MigrationInterface, QueryRunner } from "typeorm";

export class FixMissingRiskColumns1718710000000 implements MigrationInterface {
    name = 'FixMissingRiskColumns1718710000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "risk_usdt" numeric(20,8) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "initial_risk_usdt" numeric(20,8)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "initial_risk_usdt"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "risk_usdt"`);
    }
}
