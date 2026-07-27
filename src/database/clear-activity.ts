import { ensureDbCredentials } from './load-db-credentials';

// Wiped outright. Same maintenance rule as clear-db.ts: a new entity/migration
// needs a line here (or a deliberate entry in KEPT_TABLES) or it silently
// survives a "clear".
const CLEARED_TABLES = ['trade_log', 'refresh_tokens', 'token_blacklist'];

// Deliberately preserved — the whole point of this script. trading_rules is
// configuration, not disposable data, so it is never reset here (that's the
// difference from an earlier draft of this script — see the git history if
// you're wondering why "clear-data" isn't the name).
const KEPT_TABLES = ['stock_mapping', 'users', 'trading_rules'];

/**
 * Dev/test utility — wipes trade history and every session, while leaving
 * everything configured exactly as it was: stocks, users, and all of
 * trading_rules.
 *
 * Sits between the other two cleanup scripts:
 *   clear-trades    → trade_log only; every setting survives
 *   clear-activity  → this one: trade_log + every session, config untouched
 *   clear-db        → everything, including stocks, users, and config
 *
 * What happens to each table:
 *   trade_log              TRUNCATE — the whole trade history
 *   refresh_tokens         TRUNCATE — every session is invalidated (see below)
 *   token_blacklist        TRUNCATE — nothing left to blacklist once sessions are gone
 *   trading_rules          untouched, EXCEPT consecutive_failure_count/auto_paused
 *                          (see below) — investment amount, execution mode,
 *                          slippage, daily caps, allow_buy/allow_sell, and
 *                          bot_enabled all keep their configured values
 *   stock_mapping          untouched — including each stock's per-stock overrides
 *   users                  untouched — passwords, 2FA settings, and all
 *
 * consecutive_failure_count and auto_paused are reset to 0/false — same as
 * clear-trades — because they're *derived* from trade_log, not configuration:
 * leaving auto_paused=true around with zero trades left to explain it is
 * orphaned state, not a preserved setting. bot_enabled is not touched by
 * this reset; if the bot was off, it stays off (see below).
 *
 * Everyone is logged out. Clearing refresh_tokens revokes every outstanding
 * session, so all users sign in again — expected, since this clears activity.
 * Their credentials are unchanged.
 *
 * Same safety posture as the other two: a human runs this on purpose, and
 * production is hard-blocked.
 *
 * Usage: pnpm clear-activity --yes
 */
async function clearActivity(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: NODE_ENV=production. This would wipe every trade record.');
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.log(`This will permanently delete ALL rows from: ${CLEARED_TABLES.join(', ')}`);
    console.log('and reset trading_rules.consecutive_failure_count to 0 and auto_paused to false');
    console.log('(derived from trade history, not configuration — every actual setting,');
    console.log('including bot_enabled, is left exactly as configured).');
    console.log(
      `Target: ${process.env.DB_HOST ?? '127.0.0.1'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? 'trading_view_bot'}`,
    );
    console.log(`\nKEPT, untouched (configuration): ${KEPT_TABLES.join(', ')}.`);
    console.log('Every user is logged out (refresh_tokens is cleared); credentials are unchanged.');
    console.log('\nRe-run with --yes to actually do it: pnpm clear-activity --yes');
    process.exit(1);
  }

  await ensureDbCredentials();
  const { AppDataSource } = await import('./data-source');

  await AppDataSource.initialize();

  // A single TRUNCATE across all three tables is one atomic statement in
  // Postgres, so this can't leave a partial result — no explicit transaction
  // needed. RESTART IDENTITY resets the SERIAL counters so the next trade
  // starts at 1. No CASCADE needed: the only real FK here is
  // refresh_tokens -> users, and refresh_tokens is the child — truncating a
  // child never cascades to the parent, so users cannot be caught by this.
  const quotedTables = CLEARED_TABLES.map((t) => `"${t}"`).join(', ');
  await AppDataSource.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY`);

  await AppDataSource.query(
    `UPDATE "trading_rules" SET consecutive_failure_count = 0, auto_paused = false`,
  );

  console.log(`Cleared: ${CLEARED_TABLES.join(', ')}.`);
  console.log('Reset:   trading_rules.consecutive_failure_count = 0, auto_paused = false.');
  console.log(`Kept:    ${KEPT_TABLES.join(', ')} (fully untouched otherwise).`);
  console.log('Note:    bot_enabled was not changed — toggle it from the portal if needed.');
  console.log('Note:    every session was revoked; users sign in again with the same credentials.');

  await AppDataSource.destroy();
}

clearActivity().catch((error) => {
  console.error('clear-activity failed:', error);
  process.exit(1);
});
