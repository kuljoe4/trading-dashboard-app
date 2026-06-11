import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEntryDailyChangeToTrade1717800000000 implements MigrationInterface {
    name = 'AddEntryDailyChangeToTrade1717800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "entry_daily_change_pct" numeric(10,4)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "entry_daily_change_pct"`);
    }
}
