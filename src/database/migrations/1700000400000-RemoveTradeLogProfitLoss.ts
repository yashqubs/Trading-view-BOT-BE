import { MigrationInterface, QueryRunner } from 'typeorm';

// P&L was computed from TradingView's signal price, not IG's actual fill/
// market price — never authoritative, and explicitly called out as a
// limitation (PROJECT_DOCUMENTATION.md Section 19, #1: "no real-time P&L,
// view P&L on IG platform"). Removed app-wide rather than left half-shown.
export class RemoveTradeLogProfitLoss1700000400000 implements MigrationInterface {
  name = 'RemoveTradeLogProfitLoss1700000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        DROP COLUMN "profit_loss_pct",
        DROP COLUMN "profit_loss",
        DROP COLUMN "closing_price"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        ADD COLUMN "closing_price" decimal(15,4),
        ADD COLUMN "profit_loss" decimal(15,2),
        ADD COLUMN "profit_loss_pct" decimal(8,4)
    `);
  }
}
