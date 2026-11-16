export class AddFundingFeeToTrade1717600000000 {
    name = 'AddFundingFeeToTrade1717600000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "funding_fee" numeric(20,8) NOT NULL DEFAULT '0'`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "funding_fee"`);
    }
}
