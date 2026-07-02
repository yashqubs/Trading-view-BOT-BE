import { MigrationInterface, QueryRunner } from 'typeorm';

// Records the actual IG fill price, distinct from signal_price (which is
// only ever the TradingView signal used to size the trade — orders are
// placed MARKET, so the fill price can legitimately differ).
export class AddTradeLogExecutedPrice1700000500000 implements MigrationInterface {
  name = 'AddTradeLogExecutedPrice1700000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        ADD COLUMN "executed_price" decimal(12,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        DROP COLUMN "executed_price"
    `);
  }
}
