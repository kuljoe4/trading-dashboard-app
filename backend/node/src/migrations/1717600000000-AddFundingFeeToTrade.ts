import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFundingFeeToTrade1717600000000 implements MigrationInterface {
    name = 'AddFundingFeeToTrade1717600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "funding_fee" numeric(20,8) NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "funding_fee"`);
    }
}
