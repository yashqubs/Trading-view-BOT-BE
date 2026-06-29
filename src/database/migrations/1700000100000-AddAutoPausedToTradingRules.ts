import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoPausedToTradingRules1700000100000 implements MigrationInterface {
  name = 'AddAutoPausedToTradingRules1700000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trading_rules" ADD COLUMN "auto_paused" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trading_rules" DROP COLUMN "auto_paused"`);
  }
}
