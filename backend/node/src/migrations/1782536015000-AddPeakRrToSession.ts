import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddPeakRrToSession1782536015000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "session",
            new TableColumn({
                name: "peakRr",
                type: "decimal",
                precision: 10,
                scale: 4,
                default: 0
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("session", "peakRr");
    }
}
