import { TableColumn } from 'typeorm';
export class AddUpdatedAtToTrade1718200000000 {
    async up(queryRunner) {
        await queryRunner.addColumn('trade_entity', new TableColumn({
            name: 'updated_at',
            type: 'timestamp',
            isNullable: false,
            default: 'CURRENT_TIMESTAMP',
        }));
    }
    async down(queryRunner) {
        await queryRunner.dropColumn('trade_entity', 'updated_at');
    }
}
