import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL UNIQUE,
        "password_hash" varchar(255) NOT NULL,
        "role" varchar(20) NOT NULL DEFAULT 'VIEWER',
        "active" boolean NOT NULL DEFAULT true,
        "totp_secret" varchar(255),
        "totp_enabled" boolean NOT NULL DEFAULT false,
        "recovery_codes" text,
        "must_change_password" boolean NOT NULL DEFAULT true,
        "failed_login_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" timestamptz,
        "last_login_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "token_blacklist" (
        "id" SERIAL PRIMARY KEY,
        "token_hash" varchar(255) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_token_blacklist_hash" ON "token_blacklist" ("token_hash")`,
    );

    await queryRunner.query(`
      CREATE TABLE "stock_mapping" (
        "id" SERIAL PRIMARY KEY,
        "tv_ticker" varchar(20) NOT NULL UNIQUE,
        "ig_epic" varchar(60) NOT NULL,
        "instrument_name" varchar(255) NOT NULL,
        "instrument_type" varchar(50) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "investment_amount" decimal(12,2) NOT NULL,
        "max_daily_spend" decimal(12,2),
        "cool_down_minutes" integer,
        "max_open_positions" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "trading_rules" (
        "id" integer PRIMARY KEY DEFAULT 1,
        "bot_enabled" boolean NOT NULL DEFAULT true,
        "allow_buy" boolean NOT NULL DEFAULT true,
        "allow_sell" boolean NOT NULL DEFAULT true,
        "daily_max_total_investment" decimal(12,2),
        "daily_max_trade_count" integer,
        "max_open_positions_global" integer,
        "max_consecutive_failures" integer NOT NULL DEFAULT 3,
        "consecutive_failure_count" integer NOT NULL DEFAULT 0,
        "trade_start_time_utc" time NOT NULL DEFAULT '14:30:00',
        "trade_end_time_utc" time NOT NULL DEFAULT '21:00:00',
        "trade_weekdays_only" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "chk_trading_rules_singleton" CHECK ("id" = 1)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "trade_log" (
        "id" SERIAL PRIMARY KEY,
        "tv_ticker" varchar(20) NOT NULL,
        "ig_epic" varchar(60),
        "direction" varchar(4) NOT NULL,
        "signal_price" decimal(12,4) NOT NULL,
        "investment_amount" decimal(12,2),
        "quantity" decimal(12,4),
        "deal_reference" varchar(100),
        "deal_id" varchar(100),
        "status" varchar(30) NOT NULL,
        "skip_reason" varchar(100),
        "error_message" text,
        "signal_received_at" timestamptz NOT NULL,
        "executed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_trade_log_ticker" ON "trade_log" ("tv_ticker")`);
    await queryRunner.query(`CREATE INDEX "idx_trade_log_status" ON "trade_log" ("status")`);
    await queryRunner.query(
      `CREATE INDEX "idx_trade_log_created_at" ON "trade_log" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trade_log"`);
    await queryRunner.query(`DROP TABLE "trading_rules"`);
    await queryRunner.query(`DROP TABLE "stock_mapping"`);
    await queryRunner.query(`DROP TABLE "token_blacklist"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
