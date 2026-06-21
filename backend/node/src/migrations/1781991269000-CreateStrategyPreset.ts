import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateStrategyPreset1781991269000 implements MigrationInterface {
    name = 'CreateStrategyPreset1781991269000'

    public async up(queryRunner: QueryRunner): Promise<void> {
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

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "strategy_preset"`);
    }
}
