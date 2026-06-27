import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExchangeRateLimitToSettings1782536014000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "exchange_rate_limit" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "exchange_rate_limit"`);
    }
}
