export enum TradeStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  // Legacy — nothing writes this since the markets/trading-hours feature was
  // removed, but historical trade_log rows still carry it.
  MARKET_CLOSED = 'MARKET_CLOSED',
  NOT_MAPPED = 'NOT_MAPPED',
  DISABLED = 'DISABLED',
  // Legacy — nothing writes this since 2026-07-16: a SELL with no open
  // position now opens a short instead of skipping (short selling). Historical
  // rows from before that change still carry it.
  NO_POSITION = 'NO_POSITION',
  BOT_PAUSED = 'BOT_PAUSED',
  BUY_DISABLED = 'BUY_DISABLED',
  SELL_DISABLED = 'SELL_DISABLED',
  // A BUY while already long, or a SELL while already short — skipped so a
  // repeated same-direction signal never silently doubles exposure. Added
  // 2026-07-16 alongside short selling (one position per ticker, at most).
  ALREADY_LONG = 'ALREADY_LONG',
  ALREADY_SHORT = 'ALREADY_SHORT',
  DAILY_TOTAL_LIMIT = 'DAILY_TOTAL_LIMIT',
  DAILY_TRADE_LIMIT = 'DAILY_TRADE_LIMIT',
  // Legacy — nothing writes these three since the global position cap,
  // per-stock cool-down, and per-stock max-positions settings were removed,
  // but historical trade_log rows still carry them.
  GLOBAL_POSITION_LIMIT = 'GLOBAL_POSITION_LIMIT',
  COOL_DOWN = 'COOL_DOWN',
  MAX_POSITIONS_STOCK = 'MAX_POSITIONS_STOCK',
  STOCK_DAILY_LIMIT = 'STOCK_DAILY_LIMIT',
  AUTO_PAUSED = 'AUTO_PAUSED',
  DUPLICATE_SIGNAL = 'DUPLICATE_SIGNAL',
}
