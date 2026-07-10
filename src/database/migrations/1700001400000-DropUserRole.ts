import { MigrationInterface, QueryRunner } from 'typeorm';

// Role-based access (ADMIN/VIEWER) was removed — every authenticated user has
// full access, so the column no longer means anything.
export class DropUserRole1700001400000 implements MigrationInterface {
  name = 'DropUserRole1700001400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "role"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "role" varchar(20) NOT NULL DEFAULT 'ADMIN'
    `);
  }
}
