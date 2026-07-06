import { Direction } from '../../common/enums';
import { calculateLimitLevel } from './calculate-limit-level.util';

describe('calculateLimitLevel', () => {
  it('returns the exact signal price when tolerance is 0 (default, pre-slippage-feature behavior)', () => {
    expect(calculateLimitLevel(100, Direction.BUY, 0)).toBe(100);
    expect(calculateLimitLevel(100, Direction.SELL, 0)).toBe(100);
  });

  it('BUY: raises the ceiling by the tolerance (worse = paying more)', () => {
    expect(calculateLimitLevel(1000, Direction.BUY, 1)).toBe(1010);
  });

  it('SELL: lowers the floor by the tolerance (worse = receiving less)', () => {
    expect(calculateLimitLevel(1000, Direction.SELL, 1)).toBe(990);
  });

  it('rounds to 2 decimal places', () => {
    expect(calculateLimitLevel(99.99, Direction.BUY, 1.3)).toBeCloseTo(101.29, 2);
  });

  it('handles a large tolerance', () => {
    expect(calculateLimitLevel(100, Direction.BUY, 100)).toBe(200);
    expect(calculateLimitLevel(100, Direction.SELL, 100)).toBe(0);
  });
});
