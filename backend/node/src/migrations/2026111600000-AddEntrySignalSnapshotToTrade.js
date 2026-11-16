export class AddEntrySignalSnapshotToTrade2026111600000 {
    name = 'AddEntrySignalSnapshotToTrade2026111600000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_snapshot" jsonb`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_snapshot"`);
    }
}
