import { BadRequestException } from '@nestjs/common';
import { derivePriceScaleFactor, normalizeIgPrice } from './ig-price-scale.util';

describe('derivePriceScaleFactor', () => {
  it('derives 100 for a US share DFB quoting in cents-as-points (live GOOG case)', () => {
    // GOOG live 2026-07-13: IG offer 35311 vs TradingView $352.76.
    expect(derivePriceScaleFactor(35311, 352.76)).toBe(100);
  });

  it('derives 1 when IG quotes on the same scale as the signal', () => {
    expect(derivePriceScaleFactor(100.2, 100)).toBe(1);
    expect(derivePriceScaleFactor(99.8, 100)).toBe(1);
  });

  it('tolerates a genuine market-vs-signal gap without changing the factor', () => {
    // Market moved 8% since the signal — still clearly factor 100 territory.
    expect(derivePriceScaleFactor(38100, 352.76)).toBe(100);
  });

  it('throws on a non-positive or non-finite IG price', () => {
    expect(() => derivePriceScaleFactor(0, 100)).toThrow(BadRequestException);
    expect(() => derivePriceScaleFactor(-5, 100)).toThrow(BadRequestException);
    expect(() => derivePriceScaleFactor(NaN, 100)).toThrow(BadRequestException);
  });

  it('throws on a non-positive or non-finite signal price', () => {
    expect(() => derivePriceScaleFactor(100, 0)).toThrow(BadRequestException);
    expect(() => derivePriceScaleFactor(100, Infinity)).toThrow(BadRequestException);
  });
});

describe('normalizeIgPrice', () => {
  it('converts a points fill back onto the signal-price scale', () => {
    // HOOD live case: IG confirmed level 11157 for a $110.89 signal → $111.57.
    expect(normalizeIgPrice(11157, 110.89)).toBe(111.57);
  });

  it('passes a same-scale fill through unchanged', () => {
    expect(normalizeIgPrice(101.25, 100)).toBe(101.25);
  });
});
