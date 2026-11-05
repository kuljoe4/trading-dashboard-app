import { TableColumn } from 'typeorm';
export class AddIsReconciliationToTrade1718697600000 {
    async up(queryRunner) {
        await queryRunner.addColumn('trade_entity', new TableColumn({
            name: 'is_reconciliation',
            type: 'boolean',
            default: false,
        }));
    }
    async down(queryRunner) {
        await queryRunner.dropColumn('trade_entity', 'is_reconciliation');
    }
}
