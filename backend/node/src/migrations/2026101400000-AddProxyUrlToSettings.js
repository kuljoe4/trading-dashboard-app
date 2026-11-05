export class AddProxyUrlToSettings2026101400000 {
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "proxy_url" varchar`);
    }
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "settings" DROP COLUMN IF EXISTS "proxy_url"`);
    }
}
