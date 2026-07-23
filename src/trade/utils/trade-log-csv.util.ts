import { TradeLog } from '../entities/trade-log.entity';

const COLUMNS: Array<keyof TradeLog> = [
  'id',
  'tvTicker',
  'igEpic',
  'direction',
  'signalPrice',
  'executedPrice',
  'tradeValue',
  'isClosingTrade',
  'size',
  'maxSlippagePercent',
  'dealReference',
  'dealId',
  'status',
  'skipReason',
  'errorMessage',
  'signalReceivedAt',
  'executedAt',
  'createdAt',
];

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function tradeLogsToCsv(trades: TradeLog[]): string {
  const header = COLUMNS.join(',');
  const rows = trades.map((trade) =>
    COLUMNS.map((column) => escapeCsvValue(trade[column])).join(','),
  );
  return [header, ...rows].join('\n');
}
