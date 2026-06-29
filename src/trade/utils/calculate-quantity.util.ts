import { BadRequestException } from '@nestjs/common';

const QUANTITY_DECIMAL_PLACES = 4;

/**
 * quantity = investment_amount / signal_price, rounded to 4dp.
 * Guards against divide-by-zero and non-positive prices — both indicate a
 * malformed signal and must never silently produce an unintended quantity.
 */
export function calculateQuantity(investmentAmount: number, signalPrice: number): number {
  if (!Number.isFinite(signalPrice) || signalPrice <= 0) {
    throw new BadRequestException('Signal price must be a positive number');
  }
  if (!Number.isFinite(investmentAmount) || investmentAmount <= 0) {
    throw new BadRequestException('Investment amount must be a positive number');
  }

  const quantity = investmentAmount / signalPrice;
  return Number(quantity.toFixed(QUANTITY_DECIMAL_PLACES));
}
