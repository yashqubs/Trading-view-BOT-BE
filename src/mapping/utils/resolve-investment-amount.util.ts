import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';
import { StockMapping } from '../entities/stock-mapping.entity';

/**
 * A stock's own investment_amount overrides the global default when set;
 * null means inherit trading_rules.investment_amount. Always resolves to a
 * positive number — the global default itself is never null.
 *
 * `override` takes priority over both when provided — used only by the
 * dev test-signal endpoint (SignalInput.investmentAmountOverride) to size a
 * one-off test trade without touching the stock's real configuration. Real
 * webhook signals never set it, so production behaviour is unchanged.
 */
export function resolveInvestmentAmount(
  mapping: StockMapping,
  rules: TradingRules,
  override?: number | null,
): number {
  return Number(override ?? mapping.investmentAmount ?? rules.investmentAmount);
}
