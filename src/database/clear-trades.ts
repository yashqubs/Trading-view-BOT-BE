import { ensureDbCredentials } from './load-db-credentials';

/**
 * Dev/test utility — wipes every row from trade_log only. Users, stock
 * mappings, and trading rules are untouched, so the app stays fully
 * configured; only the trade history disappears. Same safety posture as
 * clear-db: a human runs this on purpose, and production is hard-blocked.
 *
 * Usage: pnpm clear-trades --yes
 */
async function clearTrades(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: NODE_ENV=production. This would wipe every trade record.');
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.log('This will permanently delete ALL rows from trade_log (trade history),');
    console.log('and reset the consecutive-failure counter + auto-pause flag on trading_rules.');
    console.log(
      `Target: ${process.env.DB_HOST ?? '127.0.0.1'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? 'trading_view_bot'}`,
    );
    console.log('Users, stock mappings, and all other trading rules are untouched.');
    console.log('\nRe-run with --yes to actually do it: pnpm clear-trades --yes');
    process.exit(1);
  }

  await ensureDbCredentials();
  const { AppDataSource } = await import('./data-source');

  await AppDataSource.initialize();

  // RESTART IDENTITY resets the id counter so the next trade starts from 1.
  await AppDataSource.query(`TRUNCATE TABLE "trade_log" RESTART IDENTITY`);

  // Failure state derived from the (now deleted) trade history. bot_enabled
  // is deliberately NOT touched — if the bot was off, a human turns it back
  // on knowingly via the portal, never a cleanup script.
  await AppDataSource.query(
    `UPDATE "trading_rules" SET consecutive_failure_count = 0, auto_paused = false`,
  );

  console.log('Cleared: trade_log (trade history is now empty).');
  console.log('Reset: consecutive_failure_count = 0, auto_paused = false.');
  console.log('Note: bot_enabled was not changed — toggle it from the portal if needed.');

  await AppDataSource.destroy();
}

clearTrades().catch((error) => {
  console.error('clear-trades failed:', error);
  process.exit(1);
});
