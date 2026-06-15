import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIpAndUserAgentToAuditLogs1718100000000 implements MigrationInterface {
    name = 'AddIpAndUserAgentToAuditLogs1718100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "ip" character varying(45)`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "userAgent" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "userAgent"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "ip"`);
    }
}
