export interface ProfitLossInput {
  entryPrice: number;
  closingPrice: number;
  quantity: number;
  investmentAmount: number;
}

export interface ProfitLossResult {
  profitLoss: number;
  profitLossPct: number;
}

/** Long position P&L: (closingPrice - entryPrice) * quantity */
export function calculateProfitLoss(input: ProfitLossInput): ProfitLossResult {
  const { entryPrice, closingPrice, quantity, investmentAmount } = input;

  const profitLoss = (closingPrice - entryPrice) * quantity;
  const profitLossPct = investmentAmount > 0 ? (profitLoss / investmentAmount) * 100 : 0;

  return { profitLoss, profitLossPct };
}
