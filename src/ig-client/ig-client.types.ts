import { Direction } from '../common/enums';

export interface IgMarket {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  marketStatus: string;
  bid: number | null;
  offer: number | null;
}

/** GET /markets/{epic} (v3) — nested shape, unlike the flat search results.
 * Only the fields this app reads; IG returns many more. Prices here are in
 * IG's own quote scale (points), NOT dollars — US share DFBs quote 1 point =
 * 1 cent, so GOOG at $353.11 appears as bid/offer ≈ 35311. */
export interface IgMarketDetails {
  snapshot: {
    marketStatus: string;
    bid: number | null;
    offer: number | null;
    decimalPlacesFactor: number | null;
    scalingFactor: number | null;
  };
}

export interface IgPosition {
  dealId: string;
  epic: string;
  direction: Direction;
  size: number;
}

export interface PlaceOrderParams {
  epic: string;
  direction: Direction;
  size: number;
  /** Omit (or MARKET) for the existing fire-at-current-price behaviour. Pass
   * LIMIT + level to attempt a fill at that exact price — IG either fills or
   * rejects immediately; this app does not track resting/working orders. */
  orderType?: 'MARKET' | 'LIMIT';
  level?: number;
}

export interface PlaceOrderResult {
  dealReference: string;
}

export interface ConfirmDealResult {
  dealId: string;
  dealStatus: 'ACCEPTED' | 'REJECTED';
  status: 'OPEN' | 'CLOSED' | 'DELETED' | 'AMENDED' | 'PARTIALLY_CLOSED' | null;
  reason: string | null;
  /** The actual price IG filled the deal at — distinct from the TradingView
   * signal price, which only sizes the trade (market orders don't specify a
   * price, so this can legitimately differ). Null on rejected/unfilled deals. */
  level: number | null;
}

export interface ClosePositionParams {
  dealId: string;
  direction: Direction;
  size: number;
  /** See PlaceOrderParams — same MARKET/LIMIT semantics apply to closes. */
  orderType?: 'MARKET' | 'LIMIT';
  level?: number;
}
