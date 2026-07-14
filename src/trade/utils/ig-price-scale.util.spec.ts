import { BadRequestException } from '@nestjs/common';
import { assertSignalPricePlausible, derivePriceScaleFactor } from './ig-price-scale.util';

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

describe('assertSignalPricePlausible', () => {
  it('passes a signal price matching the live market (points-quoted)', () => {
    // GOOG live: offer 35311, signal $352.76, factor 100 → 0.1% deviation.
    expect(() => assertSignalPricePlausible(35311, 352.76, 100)).not.toThrow();
  });

  it('passes a genuine market move within the tolerance', () => {
    // 8% gap — legitimate fast market / webhook latency.
    expect(() => assertSignalPricePlausible(38100, 352.76, 100)).not.toThrow();
  });

  it('rejects a fat-fingered price far from the real market (live PayPal case)', () => {
    // PayPal live 2026-07-14: IG ~4687 points ($46.87), test signal price 1000.
    // The ratio (4.687) snapped the factor to 10, scaling the signal to
    // 10000 vs a 4687 market — 113% off. This traded before the guard existed
    // and corrupted quantity, invested amount, and executed price at once.
    const factor = derivePriceScaleFactor(4687, 1000);
    expect(() => assertSignalPricePlausible(4687, 1000, factor)).toThrow(BadRequestException);
    expect(() => assertSignalPricePlausible(4687, 1000, factor)).toThrow(/implausible/);
  });

  it('rejects when the ratio falls between powers of ten (wrongly-snapped factor)', () => {
    // Ratio ~31.6 (midway between 10 and 100) — whichever factor is chosen,
    // the residual deviation is ~58%+ and must fail.
    expect(() => assertSignalPricePlausible(3160, 100, derivePriceScaleFactor(3160, 100))).toThrow(
      BadRequestException,
    );
  });
});
