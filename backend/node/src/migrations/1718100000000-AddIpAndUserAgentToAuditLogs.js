export class AddIpAndUserAgentToAuditLogs1718100000000 {
    name = 'AddIpAndUserAgentToAuditLogs1718100000000';
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "ip" character varying(45)`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "userAgent" text`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "userAgent"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "ip"`);
    }
}
