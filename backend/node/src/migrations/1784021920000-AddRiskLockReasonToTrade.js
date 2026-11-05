export class AddRiskLockReasonToTrade1784021920000 {
    name = 'AddRiskLockReasonToTrade1784021920000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "risk_lock_reason" character varying`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "risk_lock_reason"`);
    }
}
