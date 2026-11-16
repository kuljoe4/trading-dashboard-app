export class AddActiveTradeEvents2026093000000 {
    name = 'AddActiveTradeEvents2026093000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "active_trade_events" jsonb NOT NULL DEFAULT '[]'`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "active_trade_events"`);
    }
}
