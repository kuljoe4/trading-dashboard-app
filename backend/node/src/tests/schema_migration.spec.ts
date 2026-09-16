import { AddEntryReasonAndSignalReasonToTrade1784021930000 } from '../migrations/1784021930000-AddEntryReasonAndSignalReasonToTrade';
import { FixSchemaDrift1718710000000 } from '../migrations/1718710000000-FixSchemaDrift';

describe('Schema Migration Verification Test', () => {
  it('AddEntryReasonAndSignalReasonToTrade1784021930000 executes queries correctly', async () => {
    const migration = new AddEntryReasonAndSignalReasonToTrade1784021930000();
    const mockQueryRunner: any = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.up(mockQueryRunner);
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      `ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_reason" character varying`
    );
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      `ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_reason" character varying`
    );

    await migration.down(mockQueryRunner);
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      `ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_signal_reason"`
    );
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      `ALTER TABLE "trade_entity" DROP COLUMN IF EXISTS "entry_reason"`
    );
  });

  it('FixSchemaDrift1718710000000 contains entry_reason and entry_signal_reason', async () => {
    const migration = new FixSchemaDrift1718710000000();
    const mockQueryRunner: any = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    await migration.up(mockQueryRunner);
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      `ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_reason" character varying`
    );
    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      `ALTER TABLE "trade_entity" ADD COLUMN IF NOT EXISTS "entry_signal_reason" character varying`
    );
  });
});
