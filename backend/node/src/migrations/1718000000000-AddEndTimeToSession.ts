import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEndTimeToSession1718000000000 implements MigrationInterface {
    name = 'AddEndTimeToSession1718000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "endTime" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "session" DROP COLUMN IF EXISTS "endTime"`);
    }
}
