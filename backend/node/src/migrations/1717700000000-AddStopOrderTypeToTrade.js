export class AddStopOrderTypeToTrade1717700000000 {
    name = 'AddStopOrderTypeToTrade1717700000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "binance_stop_order_type" character varying`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "binance_stop_order_type"`);
    }
}
