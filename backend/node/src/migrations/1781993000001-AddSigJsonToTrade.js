export class AddSigJsonToTrade1781993000000 {
    name = 'AddSigJsonToTrade1781993000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "_sig_json" text`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "_sig_json"`);
    }
}
