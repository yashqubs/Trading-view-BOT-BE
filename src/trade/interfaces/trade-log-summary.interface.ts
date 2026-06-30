export interface TradeLogSummary {
  totalTrades: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  buyCount: number;
  sellCount: number;
  totalInvested: number;
  totalProfitLoss: number | null;
  avgProfitLoss: number | null;
  successRate: number;
  avgInvestment: number | null;
  winCount: number;
  lossCount: number;
}
