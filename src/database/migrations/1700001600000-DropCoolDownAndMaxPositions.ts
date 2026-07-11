import { MigrationInterface, QueryRunner } from 'typeorm';

// The per-stock cool-down, per-stock max-open-positions, and global
// max-open-positions throttles were removed — the pipeline no longer checks
// them (COOL_DOWN / MAX_POSITIONS_STOCK / GLOBAL_POSITION_LIMIT are now
// legacy-only statuses on historical trade_log rows).
export class DropCoolDownAndMaxPositions1700001600000 implements MigrationInterface {
  name = 'DropCoolDownAndMaxPositions1700001600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_mapping" DROP COLUMN IF EXISTS "cool_down_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_mapping" DROP COLUMN IF EXISTS "max_open_positions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trading_rules" DROP COLUMN IF EXISTS "max_open_positions_global"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock_mapping" ADD COLUMN "cool_down_minutes" integer`);
    await queryRunner.query(
      `ALTER TABLE "stock_mapping" ADD COLUMN "max_open_positions" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "trading_rules" ADD COLUMN "max_open_positions_global" integer`,
    );
  }
}
