import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceTotpWithEmailOtp1700000300000 implements MigrationInterface {
  name = 'ReplaceTotpWithEmailOtp1700000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        RENAME COLUMN "totp_enabled" TO "two_factor_enabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "totp_secret",
        DROP COLUMN "recovery_codes",
        ADD COLUMN "otp_code_hash" varchar(64),
        ADD COLUMN "otp_expires_at" timestamptz,
        ADD COLUMN "otp_purpose" varchar(10),
        ADD COLUMN "otp_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "otp_last_sent_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "otp_last_sent_at",
        DROP COLUMN "otp_attempts",
        DROP COLUMN "otp_purpose",
        DROP COLUMN "otp_expires_at",
        DROP COLUMN "otp_code_hash",
        ADD COLUMN "totp_secret" varchar(255),
        ADD COLUMN "recovery_codes" text
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        RENAME COLUMN "two_factor_enabled" TO "totp_enabled"
    `);
  }
}
