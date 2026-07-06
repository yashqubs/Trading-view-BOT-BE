import { MigrationInterface, QueryRunner } from 'typeorm';

// A trading-hours profile (timezone + open/close + weekdays-only) that
// stocks are assigned to — see AddMarketToStockMapping for the stock_mapping
// side of this and StockDetail's "isMarketOpen" check.
export class CreateMarkets1700000900000 implements MigrationInterface {
  name = 'CreateMarkets1700000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "markets"`);
  }
}
