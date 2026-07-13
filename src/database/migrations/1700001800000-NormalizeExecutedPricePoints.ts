import { MigrationInterface, QueryRunner } from 'typeorm';

// Backfills executed_price rows recorded before the points-scaling fix
// (2026-07-13). IG confirms fills in its own points scale (US share DFBs:
// 1 point = 1 cent), and executed_price used to store that raw value —
// 11157 for a $111.57 fill — while signal_price is in dollars. New rows are
// normalized in code (TradeService via normalizeIgPrice); this brings the
// old rows onto the same scale so executed vs signal price are comparable
// across all history.
//
// Same derivation as derivePriceScaleFactor: the factor is the nearest
// power of ten to (executed_price / signal_price); rows already on the
// signal scale derive factor 1 and are left untouched.
export class NormalizeExecutedPricePoints1700001800000 implements MigrationInterface {
  name = 'NormalizeExecutedPricePoints1700001800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: number; executed_price: string; signal_price: string }> =
      await queryRunner.query(`
        SELECT id, executed_price, signal_price
        FROM "trade_log"
        WHERE executed_price IS NOT NULL AND signal_price > 0
      `);

    for (const row of rows) {
      const executed = Number(row.executed_price);
      const signal = Number(row.signal_price);
      if (!Number.isFinite(executed) || executed <= 0) {
        continue;
      }
      const factor = 10 ** Math.round(Math.log10(executed / signal));
      if (factor !== 1 && Number.isFinite(factor) && factor > 0) {
        await queryRunner.query(`UPDATE "trade_log" SET executed_price = $1 WHERE id = $2`, [
          executed / factor,
          row.id,
        ]);
      }
    }
  }

  public async down(): Promise<void> {
    // Data normalization — the original mixed-scale values are not worth
    // reconstructing (they were wrong). Intentionally irreversible.
  }
}
