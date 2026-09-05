import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRiskLockReasonToTrade1784021920000 implements MigrationInterface {
    name = 'AddRiskLockReasonToTrade1784021920000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "risk_lock_reason" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "risk_lock_reason"`);
    }
}
