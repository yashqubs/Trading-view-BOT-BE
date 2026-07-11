import { MigrationInterface, QueryRunner } from 'typeorm';

// The markets/trading-hours feature was removed entirely: stocks no longer
// belong to a market and the signal pipeline no longer skips signals outside
// exchange hours (out-of-hours orders are now simply rejected by IG and
// logged FAILED). Historical trade_log rows keep their MARKET_CLOSED status.
export class DropMarkets1700001500000 implements MigrationInterface {
  name = 'DropMarkets1700001500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_mapping" DROP CONSTRAINT IF EXISTS "fk_stock_mapping_market"`,
    );
    await queryRunner.query(`ALTER TABLE "stock_mapping" DROP COLUMN IF EXISTS "market_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "markets"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "markets" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(100) NOT NULL UNIQUE,
        "timezone" varchar(100) NOT NULL,
        "open_time" time NOT NULL,
        "close_time" time NOT NULL,
        "weekdays_only" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `INSERT INTO "markets" ("name", "timezone", "open_time", "close_time", "weekdays_only")
       VALUES ('Default (Legacy)', 'Europe/London', '00:00', '23:59', false)`,
    );
    await queryRunner.query(`ALTER TABLE "stock_mapping" ADD COLUMN "market_id" integer`);
    await queryRunner.query(`
      UPDATE "stock_mapping"
      SET "market_id" = (SELECT "id" FROM "markets" WHERE "name" = 'Default (Legacy)')
    `);
    await queryRunner.query(`ALTER TABLE "stock_mapping" ALTER COLUMN "market_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        ADD CONSTRAINT "fk_stock_mapping_market" FOREIGN KEY ("market_id")
        REFERENCES "markets" ("id") ON DELETE RESTRICT
    `);
  }
}
