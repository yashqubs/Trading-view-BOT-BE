import { AppDataSource } from './data-source';

/**
 * Permanently removes one or more stocks: the stock_mapping config row AND
 * every trade_log row for that ticker. There's no FK between the two tables
 * (see clear-db.ts), so both are deleted explicitly, per-ticker, in a
 * transaction — either both go or neither does.
 *
 * Usage: pnpm remove-stock AAPL MSFT -- --yes
 *        pnpm remove-stock --all -- --yes
 */
async function removeStock(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  let tickers = [
    ...new Set(args.filter((a) => a !== '--yes' && a !== '--all').map((t) => t.toUpperCase())),
  ];

  if (!all && tickers.length === 0) {
    console.log('Usage: pnpm remove-stock <TICKER> [TICKER...] -- --yes');
    console.log('       pnpm remove-stock --all -- --yes');
    process.exit(1);
  }

  await AppDataSource.initialize();

  if (all) {
    const rows = await AppDataSource.query(
      'SELECT tv_ticker FROM stock_mapping ORDER BY tv_ticker',
    );
    tickers = rows.map((r: { tv_ticker: string }) => r.tv_ticker);
    if (tickers.length === 0) {
      console.log('stock_mapping is already empty — nothing to remove.');
      await AppDataSource.destroy();
      return;
    }
  }

  if (!args.includes('--yes')) {
    console.log(
      `This will permanently delete stock_mapping + all trade_log rows for: ${tickers.join(', ')}`,
    );
    console.log(
      `Target: ${process.env.DB_HOST ?? '127.0.0.1'}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? 'trading_view_bot'}`,
    );
    const rerun = all ? '--all' : tickers.join(' ');
    console.log(`\nRe-run with --yes to actually do it: pnpm remove-stock ${rerun} -- --yes`);
    await AppDataSource.destroy();
    process.exit(1);
  }

  await AppDataSource.transaction(async (manager) => {
    for (const ticker of tickers) {
      const mapping = await manager.query('SELECT id FROM stock_mapping WHERE tv_ticker = $1', [
        ticker,
      ]);
      if (mapping.length === 0) {
        console.log(`${ticker}: no stock_mapping row found, skipping.`);
        continue;
      }

      const deletedTrades = await manager.query(
        'DELETE FROM trade_log WHERE tv_ticker = $1 RETURNING id',
        [ticker],
      );
      await manager.query('DELETE FROM stock_mapping WHERE tv_ticker = $1', [ticker]);

      console.log(
        `${ticker}: removed stock_mapping row + ${deletedTrades.length} trade_log row(s).`,
      );
    }
  });

  await AppDataSource.destroy();
}

removeStock().catch((error) => {
  console.error('remove-stock failed:', error);
  process.exit(1);
});
