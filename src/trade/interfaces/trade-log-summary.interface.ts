export interface TradeLogSummary {
  totalTrades: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  buyCount: number;
  sellCount: number;
  totalInvested: number;
  successRate: number;
  avgInvestment: number | null;
}
