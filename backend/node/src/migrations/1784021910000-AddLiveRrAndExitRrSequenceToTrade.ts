import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLiveRrAndExitRrSequenceToTrade1784021910000 implements MigrationInterface {
    name = 'AddLiveRrAndExitRrSequenceToTrade1784021910000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "live_rr_sequence" jsonb`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_rr_sequence" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "live_rr_sequence"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "exit_rr_sequence"`);
    }
}
