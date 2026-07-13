import { MigrationInterface, QueryRunner } from 'typeorm';

// Records the slippage tolerance actually applied to each trade (SIGNAL_PRICE
// mode only — NULL for MARKET-mode trades, where no tolerance applies, and for
// skipped rows). trading_rules/stock_mapping hold only the *current* setting
// with no history, which made "why was/wasn't slippage applied to that trade?"
// unanswerable after the fact — this pins it per trade at execution time.
export class AddTradeLogMaxSlippage1700001900000 implements MigrationInterface {
  name = 'AddTradeLogMaxSlippage1700001900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        ADD COLUMN "max_slippage_percent" decimal(5,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        DROP COLUMN "max_slippage_percent"
    `);
  }
}
