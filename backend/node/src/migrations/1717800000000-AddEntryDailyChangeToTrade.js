export class AddEntryDailyChangeToTrade1717800000000 {
    name = 'AddEntryDailyChangeToTrade1717800000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "entry_daily_change_pct" numeric(10,4)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "entry_daily_change_pct"`);
    }
}
