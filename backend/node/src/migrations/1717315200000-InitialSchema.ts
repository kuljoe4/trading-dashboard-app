import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1717315200000 implements MigrationInterface {
    name = 'InitialSchema1717315200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "session" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" character varying NOT NULL, "startTime" TIMESTAMP NOT NULL DEFAULT now(), "endTime" TIMESTAMP, "totalPnl" numeric(20,8) NOT NULL DEFAULT '0', "balance" numeric(20,8) NOT NULL DEFAULT '0', "config" jsonb NOT NULL, "paperMode" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_f559535957305752110e527f311" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "trade_entity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "symbol" character varying NOT NULL, "direction" character varying NOT NULL, "entry_price" numeric(20,8) NOT NULL, "qty" numeric(20,8) NOT NULL, "initial_sl" numeric(20,8) NOT NULL, "current_sl" numeric(20,8) NOT NULL, "max_rr_achieved" numeric(20,8) NOT NULL DEFAULT '0', "rr_sequence_index" integer NOT NULL DEFAULT 0, "entry_ts" TIMESTAMP NOT NULL DEFAULT now(), "tp" numeric(20,8), "pnl" numeric(20,8) NOT NULL DEFAULT '0', "risk_usdt" numeric(20,8) NOT NULL DEFAULT '0', "status" character varying NOT NULL, "exit_ts" TIMESTAMP, "exit_price" numeric(20,8), "exit_reason" character varying, "exit_signal_type" character varying, "exit_signal_reason" character varying, "sl_adjustments" jsonb NOT NULL DEFAULT '[]', "pnl_pct" numeric(10,4), "binance_order_id" character varying, "binance_close_order_id" character varying, "binance_stop_order_id" character varying, "sessionId" uuid, "strategy_label" character varying, "strategy_config" jsonb, CONSTRAINT "PK_4f1648a7065963282490520624a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8562725e6e87a2d4b68e7b3967" ON "trade_entity" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_7448834015694b2a8d16781745" ON "trade_entity" ("exit_ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_535261b0981993437299185244" ON "trade_entity" ("sessionId") `);
        await queryRunner.query(`CREATE INDEX "IDX_935261b0981993437299185244" ON "trade_entity" ("strategy_label") `);
        await queryRunner.query(`CREATE TABLE "settings" ("id" integer NOT NULL DEFAULT 1, "config" jsonb NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0669b35055ca910d5402685970c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "log" ("id" SERIAL NOT NULL, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), "level" character varying NOT NULL, "context" character varying NOT NULL, "message" text NOT NULL, "metadata" jsonb, CONSTRAINT "PK_350604cbdf991d5930d95104001" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "balance_history" ("id" SERIAL NOT NULL, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), "balance" numeric(20,8) NOT NULL, "pnl" numeric(20,8) NOT NULL DEFAULT '0', "sessionId" uuid, CONSTRAINT "PK_850261b0981993437299185244" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD CONSTRAINT "FK_535261b0981993437299185244" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "balance_history" ADD CONSTRAINT "FK_850261b0981993437299185244" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "balance_history" DROP CONSTRAINT "FK_850261b0981993437299185244"`);
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP CONSTRAINT "FK_535261b0981993437299185244"`);
        await queryRunner.query(`DROP TABLE "balance_history"`);
        await queryRunner.query(`DROP TABLE "log"`);
        await queryRunner.query(`DROP TABLE "settings"`);
        await queryRunner.query(`DROP INDEX "IDX_935261b0981993437299185244"`);
        await queryRunner.query(`DROP INDEX "IDX_535261b0981993437299185244"`);
        await queryRunner.query(`DROP INDEX "IDX_7448834015694b2a8d16781745"`);
        await queryRunner.query(`DROP INDEX "IDX_8562725e6e87a2d4b68e7b3967"`);
        await queryRunner.query(`DROP TABLE "trade_entity"`);
        await queryRunner.query(`DROP TABLE "session"`);
    }

}
