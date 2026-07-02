export enum TradeLogSortBy {
  SIGNAL_RECEIVED_AT = 'signalReceivedAt',
  EXECUTED_AT = 'executedAt',
  SIGNAL_PRICE = 'signalPrice',
  INVESTMENT_AMOUNT = 'investmentAmount',
  TV_TICKER = 'tvTicker',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export const TRADE_LOG_SORT_COLUMN: Record<TradeLogSortBy, string> = {
  [TradeLogSortBy.SIGNAL_RECEIVED_AT]: 'trade.signalReceivedAt',
  [TradeLogSortBy.EXECUTED_AT]: 'trade.executedAt',
  [TradeLogSortBy.SIGNAL_PRICE]: 'trade.signalPrice',
  [TradeLogSortBy.INVESTMENT_AMOUNT]: 'trade.investmentAmount',
  [TradeLogSortBy.TV_TICKER]: 'trade.tvTicker',
};
