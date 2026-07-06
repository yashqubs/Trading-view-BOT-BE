import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs single-active-session enforcement — see AuthService.establishFullSession
// and JwtStrategy.validate. Null means no full session has been established yet
// (or the user has never logged in since this column was added).
export class AddUserCurrentSessionId1700001300000 implements MigrationInterface {
  name = 'AddUserCurrentSessionId1700001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "current_session_id" varchar(36)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "current_session_id"
    `);
  }
}
