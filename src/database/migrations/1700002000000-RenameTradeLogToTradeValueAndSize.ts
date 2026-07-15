import { MigrationInterface, QueryRunner } from 'typeorm';

// Renames trade_log.investment_amount -> trade_value, and quantity -> size.
// Both renames reflect a real semantic fix (2026-07-15), not just cosmetics:
//
// - investment_amount used to store the CONFIGURED input regardless of what
//   actually happened on IG — misleading once the sizing bug surfaced (a
//   "£2,000 invested" PayPal test was actually ~£90,000+ of real notional).
//   trade_value now stores the REAL £ notional (size × price-in-points),
//   computed only for a BUY that reached a sized order; always NULL for
//   SELL (closing a position is never a new investment) and for any BUY
//   that never got that far.
// - quantity was named for a shares model that was never actually correct
//   for this spread-bet account — IG's `size` is a £-per-point stake, not a
//   share count (proven via live trades 2026-07-14/15). `size` is the
//   accurate name for what this column has always actually held.
//
// Existing rows are NOT recomputed — old investment_amount values become
// trade_value as-is (frozen historical data, same tradeoff already accepted
// for the executed_price points-scaling migration).
export class RenameTradeLogToTradeValueAndSize1700002000000 implements MigrationInterface {
  name = 'RenameTradeLogToTradeValueAndSize1700002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log" RENAME COLUMN "investment_amount" TO "trade_value"
    `);
    await queryRunner.query(`
      ALTER TABLE "trade_log" RENAME COLUMN "quantity" TO "size"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log" RENAME COLUMN "trade_value" TO "investment_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "trade_log" RENAME COLUMN "size" TO "quantity"
    `);
  }
}
