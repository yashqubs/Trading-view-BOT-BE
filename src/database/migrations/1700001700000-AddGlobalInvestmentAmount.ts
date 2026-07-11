import { MigrationInterface, QueryRunner } from 'typeorm';

// A stock's own investment_amount is now optional — when NULL it inherits
// this new global default. See resolveInvestmentAmount() (mapping/utils).
export class AddGlobalInvestmentAmount1700001700000 implements MigrationInterface {
  name = 'AddGlobalInvestmentAmount1700001700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        ADD COLUMN "investment_amount" decimal(12,2) NOT NULL DEFAULT 500
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        ALTER COLUMN "investment_amount" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Backfill any NULL per-stock amounts from the global default before
    // reinstating NOT NULL, so the rollback doesn't fail on real data.
    await queryRunner.query(`
      UPDATE "stock_mapping"
      SET "investment_amount" = (SELECT "investment_amount" FROM "trading_rules" WHERE "id" = 1)
      WHERE "investment_amount" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        ALTER COLUMN "investment_amount" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        DROP COLUMN "investment_amount"
    `);
  }
}
