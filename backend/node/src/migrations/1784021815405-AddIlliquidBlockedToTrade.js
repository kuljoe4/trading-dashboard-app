export class AddIlliquidBlockedToTrade1784021815405 {
    name = 'AddIlliquidBlockedToTrade1784021815405';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "illiquid_blocked" boolean NOT NULL DEFAULT false`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "illiquid_blocked"`);
    }
}
