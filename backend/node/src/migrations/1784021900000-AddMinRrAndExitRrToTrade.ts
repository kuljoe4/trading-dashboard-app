import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMinRrAndExitRrToTrade1784021900000 implements MigrationInterface {
    name = 'AddMinRrAndExitRrToTrade1784021900000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "min_rr_achieved" numeric(20,8) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_rr" numeric(20,8) NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "min_rr_achieved"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "exit_rr"`);
    }
}
