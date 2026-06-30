import { calculateProfitLoss } from './calculate-profit-loss.util';

describe('calculateProfitLoss', () => {
  it('computes profit when closing price is above entry', () => {
    const result = calculateProfitLoss({
      entryPrice: 100,
      closingPrice: 110,
      quantity: 10,
      investmentAmount: 1000,
    });

    expect(result.profitLoss).toBe(100);
    expect(result.profitLossPct).toBe(10);
  });

  it('computes loss when closing price is below entry', () => {
    const result = calculateProfitLoss({
      entryPrice: 100,
      closingPrice: 90,
      quantity: 10,
      investmentAmount: 1000,
    });

    expect(result.profitLoss).toBe(-100);
    expect(result.profitLossPct).toBe(-10);
  });

  it('returns zero pct when investment amount is zero', () => {
    const result = calculateProfitLoss({
      entryPrice: 100,
      closingPrice: 120,
      quantity: 5,
      investmentAmount: 0,
    });

    expect(result.profitLoss).toBe(100);
    expect(result.profitLossPct).toBe(0);
  });
});
