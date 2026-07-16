import { MigrationInterface, QueryRunner } from 'typeorm';

// Ticker lookups are case-insensitive as of 2026-07-16 (MappingService.findByTicker
// — a real signal was logged NOT_MAPPED purely because of a casing mismatch,
// e.g. "SILVER" vs "Silver"). The plain UNIQUE constraint on tv_ticker is
// case-sensitive in Postgres by default, so it could still let two rows
// differing only by case coexist even though the app now treats them as the
// same ticker — replaced with a case-insensitive unique index so the DB
// enforces the same invariant the app does.
export class CaseInsensitiveTvTickerUnique1700002100000 implements MigrationInterface {
  name = 'CaseInsensitiveTvTickerUnique1700002100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stock_mapping" DROP CONSTRAINT "stock_mapping_tv_ticker_key"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_stock_mapping_tv_ticker_ci" ON "stock_mapping" (LOWER("tv_ticker"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "idx_stock_mapping_tv_ticker_ci"
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping" ADD CONSTRAINT "stock_mapping_tv_ticker_key" UNIQUE ("tv_ticker")
    `);
  }
}
