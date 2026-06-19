import { MigrationInterface, QueryRunner } from "typeorm";

export class AlignSchemaWithEntities1717400000000 implements MigrationInterface {
    name = 'AlignSchemaWithEntities1717400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- Session ---
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "running" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "tradingMode" character varying NOT NULL DEFAULT 'paper'`);
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "strategyLabel" character varying`);

        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='session' AND column_name='status') THEN
                    ALTER TABLE "session" DROP COLUMN "status";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='session' AND column_name='endTime') THEN
                    ALTER TABLE "session" DROP COLUMN "endTime";
                END IF;
            END $$;
        `);

        // --- TradeEntity ---
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "realized_fee" numeric(20,8) NOT NULL DEFAULT '0'`);

        // --- Settings ---
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='config') THEN
                    -- Preserve data if possible, but structure is fundamentally different.
                    -- We'll rename the old table and create a new one to avoid loss during migration failure.
                    ALTER TABLE "settings" RENAME TO "settings_old";
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='settings') THEN
                    CREATE TABLE "settings" (
                        "id" character varying NOT NULL DEFAULT 'default',
                        "binance_api_key" character varying,
                        "binance_api_secret" character varying,
                        "binance_testnet_api_key" character varying,
                        "binance_testnet_api_secret" character varying,
                        "paper_balance" numeric(20,8) NOT NULL DEFAULT '10000',
                        "testnet_balance" numeric(20,8) NOT NULL DEFAULT '0',
                        "live_balance" numeric(20,8) NOT NULL DEFAULT '0',
                        CONSTRAINT "PK_settings_id" PRIMARY KEY ("id")
                    );
                END IF;
            END $$;
        `);

        // --- Log ---
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='log' AND column_name='timestamp') THEN
                    ALTER TABLE "log" RENAME TO "log_old";
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='log') THEN
                    CREATE TABLE "log" (
                        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                        "sessionId" uuid NOT NULL,
                        "ts" character varying NOT NULL,
                        "level" character varying NOT NULL,
                        "msg" text NOT NULL,
                        CONSTRAINT "PK_log_id" PRIMARY KEY ("id")
                    );
                END IF;
            END $$;
        `);

        // --- BalanceHistory ---
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_history' AND data_type='integer' AND column_name='id') THEN
                    ALTER TABLE "balance_history" RENAME TO "balance_history_old";
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='balance_history') THEN
                    CREATE TABLE "balance_history" (
                        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                        "timestamp" TIMESTAMP NOT NULL DEFAULT now(),
                        "balance" numeric(20,8) NOT NULL,
                        "pnl" numeric(20,8) NOT NULL DEFAULT '0',
                        "type" character varying,
                        "sessionId" uuid,
                        "tradeId" uuid,
                        "tradingMode" character varying NOT NULL DEFAULT 'paper',
                        CONSTRAINT "PK_balance_history_id" PRIMARY KEY ("id")
                    );
                    ALTER TABLE "balance_history" ADD CONSTRAINT "FK_balance_history_sessionId" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Basic revert logic
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "status" character varying`);
        await queryRunner.query(`ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "endTime" TIMESTAMP`);
    }
}
