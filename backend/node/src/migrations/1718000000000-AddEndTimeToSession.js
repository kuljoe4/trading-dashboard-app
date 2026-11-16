export class AddEndTimeToSession1718000000000 {
    name = 'AddEndTimeToSession1718000000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "endTime" TIMESTAMP`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "session" DROP COLUMN IF EXISTS "endTime"`);
    }
}
