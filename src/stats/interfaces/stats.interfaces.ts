import { TradeStatus } from '../../common/enums';

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
