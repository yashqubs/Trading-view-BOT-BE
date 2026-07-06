import { MigrationInterface, QueryRunner } from 'typeorm';

// Trading hours are now per-market (see CreateMarkets / AddMarketToStockMapping)
// instead of one global UTC window — these three columns are superseded.
export class DropLegacyTradingHoursFromTradingRules1700001100000 implements MigrationInterface {
  name = 'DropLegacyTradingHoursFromTradingRules1700001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trading_rules" DROP COLUMN "trade_start_time_utc"`);
    await queryRunner.query(`ALTER TABLE "trading_rules" DROP COLUMN "trade_end_time_utc"`);
    await queryRunner.query(`ALTER TABLE "trading_rules" DROP COLUMN "trade_weekdays_only"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        ADD COLUMN "trade_start_time_utc" time NOT NULL DEFAULT '14:30:00'
    `);
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        ADD COLUMN "trade_end_time_utc" time NOT NULL DEFAULT '21:00:00'
    `);
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        ADD COLUMN "trade_weekdays_only" boolean NOT NULL DEFAULT true
    `);
  }
}
