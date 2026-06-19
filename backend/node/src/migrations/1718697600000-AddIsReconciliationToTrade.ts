import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIsReconciliationToTrade1718697600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'trade_entity',
      new TableColumn({
        name: 'is_reconciliation',
        type: 'boolean',
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('trade_entity', 'is_reconciliation');
  }
}
