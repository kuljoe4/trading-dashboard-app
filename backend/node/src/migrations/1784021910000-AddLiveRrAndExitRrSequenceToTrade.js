export class AddLiveRrAndExitRrSequenceToTrade1784021910000 {
    name = 'AddLiveRrAndExitRrSequenceToTrade1784021910000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "live_rr_sequence" jsonb`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_rr_sequence" jsonb`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "live_rr_sequence"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "exit_rr_sequence"`);
    }
}
