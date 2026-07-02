import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets a trade be filled at IG's current market price (default, matches
// existing behaviour) or as a LIMIT order at the exact TradingView signal
// price. trading_rules.execution_mode is the global default; a stock's own
// execution_mode overrides it when set, and inherits it when NULL.
export class AddExecutionMode1700000600000 implements MigrationInterface {
  name = 'AddExecutionMode1700000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        ADD COLUMN "execution_mode" varchar(20) NOT NULL DEFAULT 'MARKET'
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        ADD COLUMN "execution_mode" varchar(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        DROP COLUMN "execution_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        DROP COLUMN "execution_mode"
    `);
  }
}
