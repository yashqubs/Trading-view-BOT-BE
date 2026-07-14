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
 * per trade from IG's own live quote rather than hardcoded ×100 — instruments
 * that quote 1:1 with the signal derive factor 1 and pass through unchanged,
 * and no per-instrument configuration is needed.
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

/** The most a signal price may deviate from IG's live quote (after scale
 * conversion) and still trade. Generous enough for fast markets and webhook
 * latency; tight enough that a fat-fingered test price or a misconfigured
 * TradingView alert can't trade on a distorted scale (a PayPal test priced
 * at 1000 against a real $46.87 market sized the trade ~21× wrong AND bent
 * the power-of-ten derivation, silently corrupting quantity, invested amount,
 * executed price, and the slippage ceiling all at once). */
export const MAX_SIGNAL_DEVIATION_PERCENT = 20;

/**
 * Fail-safe gate run before ANY order is placed: the scaled signal price must
 * be within MAX_SIGNAL_DEVIATION_PERCENT of IG's live quote. Throws (trade
 * logs FAILED, IG never called) when it isn't — never trade on a price that
 * doesn't resemble the real market. Also catches a wrongly-snapped scale
 * factor: if the ratio fell between powers of ten, the residual deviation is
 * at least ~58% and always fails this check.
 */
export function assertSignalPricePlausible(
  igPrice: number,
  signalPrice: number,
  scaleFactor: number,
): void {
  const scaledSignal = signalPrice * scaleFactor;
  const deviationPercent = (Math.abs(scaledSignal - igPrice) / igPrice) * 100;
  if (deviationPercent > MAX_SIGNAL_DEVIATION_PERCENT) {
    throw new BadRequestException(
      `Signal price ${signalPrice} is ${deviationPercent.toFixed(1)}% away from IG's live market price — refusing to trade on an implausible price`,
    );
  }
}
