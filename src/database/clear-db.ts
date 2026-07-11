import { ensureDbCredentials } from './load-db-credentials';

// Every table this app owns. Order doesn't matter for TRUNCATE — CASCADE
// handles the real FKs (refresh_tokens -> users) — but this list itself
// matters: a new entity/migration needs a matching line here or it silently
// survives a "clear".
const TABLES = [
  'trade_log',
  'stock_mapping',
  'trading_rules',
  'token_blacklist',
  'refresh_tokens',
  'users',
];

/**
 * Dev/test utility — wipes every row from every table (schema stays intact,
 * migrations don't need to re-run). Deliberately NOT wired into any
 * automated pipeline; a human runs this on purpose, once, locally or against
 * a demo DB. Never touches anything in production (hard-blocked below).
 *
 * Usage: pnpm clear-db --yes
 */
async function clearDb(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: NODE_ENV=production. This would wipe every trade record.');
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.log(`This will permanently delete ALL data from: ${TABLES.join(', ')}`);
    console.log(
      `Target: ${process.env.DB_HOST ?? '127.0.0.1'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? 'trading_view_bot'}`,
    );
    console.log('Table structure and migrations are untouched — only rows are removed.');
    console.log('\nRe-run with --yes to actually do it: pnpm clear-db --yes');
    process.exit(1);
  }

  await ensureDbCredentials();
  const { AppDataSource } = await import('./data-source');

  await AppDataSource.initialize();

  const quotedTables = TABLES.map((t) => `"${t}"`).join(', ');
  // RESTART IDENTITY also resets the SERIAL id counters (stock_mapping,
  // trade_log) back to 1, so a freshly-cleared DB behaves like a brand new one.
  await AppDataSource.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);

  console.log(`Cleared: ${TABLES.join(', ')}`);
  console.log('Run `pnpm seed` to recreate the first admin user + default trading_rules row.');

  await AppDataSource.destroy();
}

clearDb().catch((error) => {
  console.error('clear-db failed:', error);
  process.exit(1);
});
