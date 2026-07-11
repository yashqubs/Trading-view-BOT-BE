import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';
import { StockMapping } from '../entities/stock-mapping.entity';

/**
 * A stock's own investment_amount overrides the global default when set;
 * null means inherit trading_rules.investment_amount. Always resolves to a
 * positive number — the global default itself is never null.
 */
export function resolveInvestmentAmount(mapping: StockMapping, rules: TradingRules): number {
  return Number(mapping.investmentAmount ?? rules.investmentAmount);
}
