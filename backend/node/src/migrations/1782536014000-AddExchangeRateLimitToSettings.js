export class AddExchangeRateLimitToSettings1782536014000 {
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "exchange_rate_limit" integer`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "exchange_rate_limit"`);
    }
}
