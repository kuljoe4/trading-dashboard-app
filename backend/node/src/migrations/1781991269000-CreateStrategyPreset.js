export class CreateStrategyPreset1781991269000 {
    name = 'CreateStrategyPreset1781991269000';
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "strategy_preset" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "name" character varying NOT NULL,
            "config" jsonb NOT NULL,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_strategy_preset_id" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_strategy_preset_name" UNIQUE ("name")
        )`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE IF EXISTS "strategy_preset"`);
    }
}
