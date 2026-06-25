import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateKlinesTable1781994000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'klines',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            isPrimary: true,
          },
          {
            name: 'symbol',
            type: 'varchar',
          },
          {
            name: 'interval',
            type: 'varchar',
          },
          {
            name: 'time',
            type: 'bigint',
          },
          {
            name: 'open',
            type: 'numeric',
            precision: 20,
            scale: 8,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 20,
            scale: 8,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 20,
            scale: 8,
          },
          {
            name: 'close',
            type: 'numeric',
            precision: 20,
            scale: 8,
          },
          {
            name: 'volume',
            type: 'numeric',
            precision: 20,
            scale: 8,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndices('klines', [
      new TableIndex({
        name: 'IDX_KLINES_SYMBOL_INTERVAL_TIME',
        columnNames: ['symbol', 'interval', 'time'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'IDX_KLINES_SYMBOL',
        columnNames: ['symbol'],
      }),
      new TableIndex({
        name: 'IDX_KLINES_INTERVAL',
        columnNames: ['interval'],
      }),
      new TableIndex({
        name: 'IDX_KLINES_TIME',
        columnNames: ['time'],
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('klines');
  }
}
