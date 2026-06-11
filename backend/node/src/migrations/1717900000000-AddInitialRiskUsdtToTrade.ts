import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInitialRiskUsdtToTrade1717900000000 implements MigrationInterface {
    name = 'AddInitialRiskUsdtToTrade1717900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "initial_risk_usdt" numeric(20,8)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "initial_risk_usdt"`);
    }
}
