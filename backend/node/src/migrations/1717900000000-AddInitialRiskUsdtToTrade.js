export class AddInitialRiskUsdtToTrade1717900000000 {
    name = 'AddInitialRiskUsdtToTrade1717900000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "initial_risk_usdt" numeric(20,8)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "initial_risk_usdt"`);
    }
}
