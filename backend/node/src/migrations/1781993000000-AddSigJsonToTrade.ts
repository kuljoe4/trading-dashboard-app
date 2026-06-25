import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSigJsonToTrade1781993000000 implements MigrationInterface {
    name = 'AddSigJsonToTrade1781993000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "_sig_json" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "_sig_json"`);
    }
}
