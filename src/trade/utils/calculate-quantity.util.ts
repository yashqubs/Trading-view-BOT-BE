import { BadRequestException } from '@nestjs/common';

/**
 * quantity = floor(investment_amount / signal_price) — whole shares only,
 * rounded down so the actual spend never exceeds investment_amount.
 * Guards against divide-by-zero and non-positive prices (malformed signal),
 * and against an investment amount too small to buy even one share at this
 * price — both must never silently produce an unintended quantity or a
 * zero-size order.
 */
export function calculateQuantity(investmentAmount: number, signalPrice: number): number {
  if (!Number.isFinite(signalPrice) || signalPrice <= 0) {
    throw new BadRequestException('Signal price must be a positive number');
  }
  if (!Number.isFinite(investmentAmount) || investmentAmount <= 0) {
    throw new BadRequestException('Investment amount must be a positive number');
  }

  const quantity = Math.floor(investmentAmount / signalPrice);
  if (quantity <= 0) {
    throw new BadRequestException(
      'Investment amount is too small to buy a whole share at this price',
    );
  }
  return quantity;
}
