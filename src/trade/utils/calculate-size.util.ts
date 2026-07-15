import { BadRequestException } from '@nestjs/common';

const SIZE_DECIMAL_PLACES = 2;

/**
 * IG's `size` is a stake-per-point (e.g. £/point), NOT a share count —
 * confirmed live 2026-07-14/15: closing a size-1 GOOG position after a
 * 2-point move paid exactly £2 profit, and a size-0.24 PayPal position moved
 * 12.2 points for a £2.93 loss (0.24 × 12.2 = 2.928). Treating size as
 * shares (the original, wrong model) sent orders ~100x too large whenever a
 * realistic signal price was used.
 *
 * size = investment_amount ÷ price_in_points, floored to 2 decimal places so
 * the real notional (size × price_in_points) never exceeds the configured
 * investment amount. `pricePoints` must already be on IG's quote scale (see
 * derivePriceScaleFactor) — passing a raw dollar price here reproduces the
 * exact overexposure bug this replaces.
 */
export function calculateSize(investmentAmount: number, pricePoints: number): number {
  if (!Number.isFinite(pricePoints) || pricePoints <= 0) {
    throw new BadRequestException('Price must be a positive number');
  }
  if (!Number.isFinite(investmentAmount) || investmentAmount <= 0) {
    throw new BadRequestException('Investment amount must be a positive number');
  }

  const factor = 10 ** SIZE_DECIMAL_PLACES;
  const size = Math.floor((investmentAmount / pricePoints) * factor) / factor;
  if (size <= 0) {
    throw new BadRequestException(
      'Investment amount is too small to open any position at this price',
    );
  }
  return size;
}
