import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs the sliding-idle-timeout refresh flow: a short-lived access token
// (15m) plus this longer-lived, rotating refresh token (1h, reset on every
// use) — see SessionService and AuthService.refresh(). Only the hash is ever
// stored, same pattern as token_blacklist.
export class AddRefreshTokens1700000800000 implements MigrationInterface {
  name = 'AddRefreshTokens1700000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" SERIAL PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar(255) NOT NULL UNIQUE,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" ("token_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
