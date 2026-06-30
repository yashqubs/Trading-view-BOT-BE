import { Direction, TradeStatus } from '../../common/enums';

export interface OverviewStats {
  botEnabled: boolean;
  autoPaused: boolean;
  totalTrades: number;
  todaysTrades: number;
  todaysInvested: number;
  dailyMaxTotalInvestment: number | null;
  dailyMaxTradeCount: number | null;
  openPositions: number;
  successRate: number;
  consecutiveFailures: number;
  buyCount: number;
  sellCount: number;
}

export interface DailyActivityPoint {
  date: string;
  trades: number;
  invested: number;
}

export interface StockActivity {
  tvTicker: string;
  trades: number;
  invested: number;
}

export interface StatusBreakdownPoint {
  status: TradeStatus;
  count: number;
}

export interface OpenPosition {
  tvTicker: string;
  instrumentName: string;
  igEpic: string;
  direction: Direction;
  size: number;
  /** False if IG reports a position for an epic that has no (or no longer has an) active stock_mapping row. */
  mapped: boolean;
}

export interface StockStats {
  tvTicker: string;
  totalTrades: number;
  totalInvested: number;
  buyCount: number;
  sellCount: number;
  successRate: number;
  lastTradedAt: Date | null;
  currentlyOpen: boolean;
  timeline: { date: string; trades: number }[];
  entryPrices: { date: string; price: number }[];
  statusBreakdown: StatusBreakdownPoint[];
  investedOverTime: { date: string; invested: number }[];
}
