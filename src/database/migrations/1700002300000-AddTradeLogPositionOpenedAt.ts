import { MigrationInterface, QueryRunner } from 'typeorm';

// A closing row in the trade history said nothing about how long the exposure
// had been held — you could see that a position was closed, but not when it
// had been opened, and the opening row is a separate entry that may be pages
// away (or predate this bot entirely). position_opened_at carries IG's own
// open time for the position being closed, captured at execution time from
// IgPosition.openedAt; on a successful open it's that fill's own moment, so
// one column answers "when did this position start" on either kind of row.
//
// Existing rows stay null on purpose and are NOT back-filled: IG's open time
// was never captured historically, and there is no way to reconstruct it
// after the fact for a position that has since been closed. Guessing it from
// the matching opening row's executed_at would be wrong for anything opened
// outside this bot, and indistinguishable from a real value once written. The
// portal renders null as "—".
export class AddTradeLogPositionOpenedAt1700002300000 implements MigrationInterface {
  name = 'AddTradeLogPositionOpenedAt1700002300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log" ADD COLUMN "position_opened_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_log" DROP COLUMN "position_opened_at"
    `);
  }
}
