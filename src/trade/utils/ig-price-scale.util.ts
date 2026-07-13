import { BadRequestException } from '@nestjs/common';

/**
 * IG quotes share markets in points on its own scale, which differs from the
 * TradingView dollar price by a power of ten — US share DFBs quote 1 point =
 * 1 cent, so GOOG at $353.11 is 35311 on IG (confirmed live 2026-07-13:
 * sending a dollar LIMIT level of 400 against a 35311 market was ~99% below
 * it, which is why every SIGNAL_PRICE order failed
 * LIMIT_ORDER_WRONG_SIDE_OF_MARKET regardless of the dollar value chosen).
 *
 * The factor is the nearest power of ten to (igPrice / signalPrice), derived
 * per call from IG's own quote rather than hardcoded ×100 — instruments that
 * quote 1:1 with the signal derive factor 1 and pass through unchanged, and
 * no per-instrument configuration is needed. The residual difference after
 * factoring is the genuine market-vs-signal price gap, which the LIMIT level
 * itself enforces (that's the slippage check).
 */
export function derivePriceScaleFactor(igPrice: number, signalPrice: number): number {
  if (!Number.isFinite(igPrice) || igPrice <= 0) {
    throw new BadRequestException('IG reference price must be a positive number');
  }
  if (!Number.isFinite(signalPrice) || signalPrice <= 0) {
    throw new BadRequestException('Signal price must be a positive number');
  }
  return 10 ** Math.round(Math.log10(igPrice / signalPrice));
}

/** Converts a price from IG's quote scale back onto the signal-price scale
 * (dollars), so trade_log.executed_price is directly comparable to
 * signal_price instead of surfacing raw points (11157 vs $111.57). */
export function normalizeIgPrice(igPrice: number, signalPrice: number): number {
  return igPrice / derivePriceScaleFactor(igPrice, signalPrice);
}
