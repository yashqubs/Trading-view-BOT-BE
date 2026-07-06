import { MigrationInterface, QueryRunner } from 'typeorm';

// Backfills a "Default (Legacy)" market from whatever the global
// trading_rules window currently holds, so every pre-existing stock keeps
// trading at exactly the same hours it did before markets existed — nothing
// changes until an admin explicitly reassigns a stock to a real market (UK/
// US/India/etc, seeded by seed.ts). See DropLegacyTradingHoursFromTradingRules
// for the migration that later removes the now-superseded trading_rules columns.
export class AddMarketToStockMapping1700001000000 implements MigrationInterface {
  name = 'AddMarketToStockMapping1700001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_mapping" ADD COLUMN "market_id" integer`);

    const rulesRows: Array<{
      trade_start_time_utc: string;
      trade_end_time_utc: string;
      trade_weekdays_only: boolean;
    }> = await queryRunner.query(
      `SELECT trade_start_time_utc, trade_end_time_utc, trade_weekdays_only FROM "trading_rules" WHERE "id" = 1`,
    );

    // Falls back to the entity's original defaults if trading_rules hasn't
    // been seeded yet (migrations always run before `pnpm seed`) — this
    // still guarantees a legacy market exists for any stock_mapping rows
    // that might already be present.
    const legacy = rulesRows[0] ?? {
      trade_start_time_utc: '14:30:00',
      trade_end_time_utc: '21:00:00',
      trade_weekdays_only: true,
    };

    await queryRunner.query(
      `INSERT INTO "markets" ("name", "timezone", "open_time", "close_time", "weekdays_only")
       VALUES ('Default (Legacy)', 'UTC', $1, $2, $3)`,
      [legacy.trade_start_time_utc, legacy.trade_end_time_utc, legacy.trade_weekdays_only],
    );

    await queryRunner.query(`
      UPDATE "stock_mapping"
      SET "market_id" = (SELECT "id" FROM "markets" WHERE "name" = 'Default (Legacy)')
      WHERE "market_id" IS NULL
    `);

    await queryRunner.query(`ALTER TABLE "stock_mapping" ALTER COLUMN "market_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        ADD CONSTRAINT "fk_stock_mapping_market" FOREIGN KEY ("market_id")
        REFERENCES "markets" ("id") ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_mapping" DROP CONSTRAINT "fk_stock_mapping_market"`,
    );
    await queryRunner.query(`ALTER TABLE "stock_mapping" DROP COLUMN "market_id"`);
    // Best-effort — matches this repo's other migrations' down() style,
    // which isn't hardened for reverting long after the fact.
    await queryRunner.query(`DELETE FROM "markets" WHERE "name" = 'Default (Legacy)'`);
  }
}
