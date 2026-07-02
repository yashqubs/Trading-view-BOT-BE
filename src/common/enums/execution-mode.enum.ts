/**
 * How a trade's execution price is determined once every condition check
 * has passed. MARKET fills immediately at whatever price IG currently
 * offers (orderType: MARKET — no price specified). SIGNAL_PRICE places a
 * LIMIT order at the exact TradingView signal price — it will only fill at
 * that price or better, so it can go unfilled if the market has already
 * moved past it. Neither this app nor IG's /positions/otc endpoint tracks
 * unfilled limit orders as a pending state here: if it doesn't fill
 * immediately, it is logged FAILED the same way a rejected market order is
 * — there is no working-order lifecycle.
 */
export enum ExecutionMode {
  MARKET = 'MARKET',
  SIGNAL_PRICE = 'SIGNAL_PRICE',
}
