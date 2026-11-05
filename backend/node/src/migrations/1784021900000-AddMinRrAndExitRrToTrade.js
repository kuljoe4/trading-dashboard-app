export class AddMinRrAndExitRrToTrade1784021900000 {
    name = 'AddMinRrAndExitRrToTrade1784021900000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "min_rr_achieved" numeric(20,8) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "exit_rr" numeric(20,8) NOT NULL DEFAULT '0'`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "min_rr_achieved"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "exit_rr"`);
    }
}
