import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProxyUrlToSettings2026101400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "proxy_url" varchar`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "proxy_url"`);
    }
}
