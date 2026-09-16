import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEntryReasonAndSignalReasonToTrade1784021930000 implements MigrationInterface {
    name = 'AddEntryReasonAndSignalReasonToTrade1784021930000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_reason" character varying`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_reason" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_reason"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_reason"`);
    }
}
