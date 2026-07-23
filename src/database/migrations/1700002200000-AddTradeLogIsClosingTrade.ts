import { MigrationInterface, QueryRunner } from 'typeorm';

// trade_value now gets populated for closes too (2026-07-24 — previously
// always null, since closing a position was never "new investment"; the
// client wants to see the real £ notional of a close as well). But every
// existing "money invested" aggregate (daily investment/spend caps, dashboard
// stats, per-stock charts) sums trade_value assuming it only ever represents
// new investment — if a close's notional got summed in there too, closing a
// position would look like fresh investment and the caps would trigger early.
// is_closing_trade lets every one of those queries exclude closes while
// trade_value itself stays populated for both, for display. Existing rows
// default to false — harmless, since their trade_value is already null for
// any historical close (it was never captured), so they contribute 0 to any
// sum regardless of this flag.
export class AddTradeLogIsClosingTrade1700002200000 implements MigrationInterface {
  name = 'AddTradeLogIsClosingTrade1700002200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log" ADD COLUMN "is_closing_trade" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log" DROP COLUMN "is_closing_trade"
    `);
  }
}
