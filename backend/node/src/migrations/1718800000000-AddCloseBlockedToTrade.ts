import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCloseBlockedToTrade1718800000000 implements MigrationInterface {
    name = 'AddCloseBlockedToTrade1718800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "close_attempts" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "close_blocked" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "close_blocked"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "close_attempts"`);
    }
}
