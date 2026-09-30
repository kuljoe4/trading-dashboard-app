import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActiveTradeEvents2026093000000 implements MigrationInterface {
  name = 'AddActiveTradeEvents2026093000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trade_entity" ADD "active_trade_events" jsonb NOT NULL DEFAULT '[]'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "active_trade_events"`);
  }
}
