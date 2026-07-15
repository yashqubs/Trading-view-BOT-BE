import { BadRequestException } from '@nestjs/common';
import { calculateSize } from './calculate-size.util';

describe('calculateSize', () => {
  it('divides investment amount by price-in-points', () => {
    // £1,200 investment, PayPal at 5,000 points ($50 × 100 scale factor).
    expect(calculateSize(1200, 5000)).toBe(0.24);
  });

  it('floors to 2 decimal places so notional never exceeds the investment amount', () => {
    // 1000 / 3333.33 = 0.30003... -> must floor to 0.30, not round to 0.3000 or up.
    const size = calculateSize(1000, 3333.33);
    expect(size).toBe(0.3);
    expect(size * 3333.33).toBeLessThanOrEqual(1000);
  });

  it('matches the live PayPal proof (0.24 size, 12.2-point move, -£2.93)', () => {
    expect(calculateSize(1200, 4703)).toBeCloseTo(0.25, 2);
  });

  it('throws when the investment amount floors to a non-positive size', () => {
    expect(() => calculateSize(100, 50000)).toThrow(BadRequestException);
    expect(() => calculateSize(100, 50000)).toThrow(/too small/);
  });

  it('throws when price is zero, negative, or non-finite', () => {
    expect(() => calculateSize(1000, 0)).toThrow(BadRequestException);
    expect(() => calculateSize(1000, -100)).toThrow(BadRequestException);
    expect(() => calculateSize(1000, Number.NaN)).toThrow(BadRequestException);
  });

  it('throws when investment amount is zero, negative, or non-finite', () => {
    expect(() => calculateSize(0, 5000)).toThrow(BadRequestException);
    expect(() => calculateSize(-100, 5000)).toThrow(BadRequestException);
    expect(() => calculateSize(Number.POSITIVE_INFINITY, 5000)).toThrow(BadRequestException);
  });
});
