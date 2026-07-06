import { MigrationInterface, QueryRunner } from 'typeorm';

// Slippage tolerance for SIGNAL_PRICE mode's LIMIT order — see
// trade.service.ts. Default 0 on trading_rules preserves today's exact-price
// behavior for every existing stock until an admin opts in.
export class AddMaxSlippagePercent1700001200000 implements MigrationInterface {
  name = 'AddMaxSlippagePercent1700001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trading_rules"
        ADD COLUMN "max_slippage_percent" decimal(5,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "stock_mapping"
        ADD COLUMN "max_slippage_percent" decimal(5,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_mapping" DROP COLUMN "max_slippage_percent"`);
    await queryRunner.query(`ALTER TABLE "trading_rules" DROP COLUMN "max_slippage_percent"`);
  }
}
