import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEntrySignalSnapshotToTrade2026111600000 implements MigrationInterface {
  name = 'AddEntrySignalSnapshotToTrade2026111600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_snapshot" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_snapshot"`);
  }
}
