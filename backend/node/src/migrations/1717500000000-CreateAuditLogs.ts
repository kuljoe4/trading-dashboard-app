import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditLogs1717500000000 implements MigrationInterface {
    name = 'CreateAuditLogs1717500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "audit_logs" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "timestamp" TIMESTAMP NOT NULL DEFAULT now(),
            "action" character varying(50) NOT NULL,
            "actor" character varying(255),
            "resourceId" character varying(100),
            "details" jsonb,
            "level" character varying(20) NOT NULL DEFAULT 'INFO',
            CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
        )`);
        
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_timestamp" ON "audit_logs" ("timestamp")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_resourceId" ON "audit_logs" ("resourceId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_resourceId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_timestamp"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    }
}
