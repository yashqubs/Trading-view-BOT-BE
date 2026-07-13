import { BadRequestException } from '@nestjs/common';
import { calculateQuantity } from './calculate-quantity.util';

describe('calculateQuantity', () => {
  it('divides investment amount by signal price', () => {
    expect(calculateQuantity(1000, 100)).toBe(10);
  });

  it('rounds down to the nearest whole share', () => {
    expect(calculateQuantity(500, 110)).toBe(4); // 4.5454... -> 4, never 5 (would exceed the investment amount)
  });

  it('throws when the investment amount cannot buy even one whole share at this price', () => {
    expect(() => calculateQuantity(50, 110)).toThrow(BadRequestException);
  });

  it('throws when signal price is zero (divide-by-zero guard)', () => {
    expect(() => calculateQuantity(1000, 0)).toThrow(BadRequestException);
  });

  it('throws when signal price is negative', () => {
    expect(() => calculateQuantity(1000, -5)).toThrow(BadRequestException);
  });

  it('throws when investment amount is zero', () => {
    expect(() => calculateQuantity(0, 100)).toThrow(BadRequestException);
  });

  it('throws when investment amount is negative', () => {
    expect(() => calculateQuantity(-100, 100)).toThrow(BadRequestException);
  });

  it('throws when signal price is not finite', () => {
    expect(() => calculateQuantity(1000, Number.NaN)).toThrow(BadRequestException);
    expect(() => calculateQuantity(1000, Number.POSITIVE_INFINITY)).toThrow(BadRequestException);
  });
});
