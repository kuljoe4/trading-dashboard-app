import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRrSequencesToTrade1784022000000 implements MigrationInterface {
    name = 'AddRrSequencesToTrade1784022000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "live_rr_sequence" jsonb`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_rr_sequence" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "live_rr_sequence"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "exit_rr_sequence"`);
    }
}
