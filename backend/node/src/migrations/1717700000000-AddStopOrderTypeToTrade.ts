import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStopOrderTypeToTrade1717700000000 implements MigrationInterface {
    name = 'AddStopOrderTypeToTrade1717700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" ADD "binance_stop_order_type" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trade_entity" DROP COLUMN "binance_stop_order_type"`);
    }
}
