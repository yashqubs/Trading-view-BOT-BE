import { MigrationInterface, QueryRunner } from 'typeorm';

// Stores the plaintext of a currently-pending invite/reset temp password so
// an admin can resend the exact same one instead of the "reset password"
// button silently minting a new one (and invalidating whatever was already
// emailed/shown) on every click. Cleared the moment the user sets their own
// real password, or a genuinely new temp password is issued.
export class AddUserTempPassword1700000700000 implements MigrationInterface {
  name = 'AddUserTempPassword1700000700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "temp_password" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "temp_password"
    `);
  }
}
