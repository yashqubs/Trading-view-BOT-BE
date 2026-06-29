import { BadRequestException } from '@nestjs/common';
import { calculateQuantity } from './calculate-quantity.util';

describe('calculateQuantity', () => {
  it('divides investment amount by signal price', () => {
    expect(calculateQuantity(1000, 100)).toBe(10);
  });

  it('rounds to 4 decimal places', () => {
    expect(calculateQuantity(100, 3)).toBeCloseTo(33.3333, 4);
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
