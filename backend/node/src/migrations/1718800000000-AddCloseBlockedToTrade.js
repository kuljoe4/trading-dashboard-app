export class AddCloseBlockedToTrade1718800000000 {
    name = 'AddCloseBlockedToTrade1718800000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "close_attempts" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "close_blocked" boolean NOT NULL DEFAULT false`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "close_blocked"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "close_attempts"`);
    }
}
