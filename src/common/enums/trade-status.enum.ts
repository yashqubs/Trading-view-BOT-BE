export enum TradeStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  // Legacy — nothing writes this since the markets/trading-hours feature was
  // removed, but historical trade_log rows still carry it.
  MARKET_CLOSED = 'MARKET_CLOSED',
  NOT_MAPPED = 'NOT_MAPPED',
  DISABLED = 'DISABLED',
  NO_POSITION = 'NO_POSITION',
  BOT_PAUSED = 'BOT_PAUSED',
  BUY_DISABLED = 'BUY_DISABLED',
  SELL_DISABLED = 'SELL_DISABLED',
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
