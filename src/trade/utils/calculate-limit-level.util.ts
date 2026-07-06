import { Direction } from '../../common/enums';

const LEVEL_DECIMAL_PLACES = 2;

/**
 * The LIMIT order's `level` for SIGNAL_PRICE mode — the worst price the
 * order is allowed to fill at before IG rejects it instead (see
 * TradeService.executeTrade). `maxSlippagePercent` is the tolerance around
 * the signal price:
 *   BUY:  level = signalPrice * (1 + slippage/100) — filling above this is
 *         "worse" (paying more), so this is the ceiling.
 *   SELL: level = signalPrice * (1 - slippage/100) — filling below this is
 *         "worse" (receiving less), so this is the floor.
 * 0 (the default) means the level is exactly the signal price, identical to
 * behavior before this setting existed.
 */
export function calculateLimitLevel(
  signalPrice: number,
  direction: Direction,
  maxSlippagePercent: number,
): number {
  const factor = maxSlippagePercent / 100;
  const level =
    direction === Direction.BUY ? signalPrice * (1 + factor) : signalPrice * (1 - factor);
  return Number(level.toFixed(LEVEL_DECIMAL_PLACES));
}
