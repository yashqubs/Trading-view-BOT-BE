import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTradeLogProfitLoss1700000200000 implements MigrationInterface {
  name = 'AddTradeLogProfitLoss1700000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        ADD COLUMN "closing_price" decimal(15,4),
        ADD COLUMN "profit_loss" decimal(15,2),
        ADD COLUMN "profit_loss_pct" decimal(8,4)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log"
        DROP COLUMN "profit_loss_pct",
        DROP COLUMN "profit_loss",
        DROP COLUMN "closing_price"
    `);
  }
}
