import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';
import { isMarketOpen } from './market-hours.util';

function buildRules(overrides: Partial<TradingRules> = {}): TradingRules {
  return {
    id: 1,
    botEnabled: true,
    autoPaused: false,
    allowBuy: true,
    allowSell: true,
    dailyMaxTotalInvestment: null,
    dailyMaxTradeCount: null,
    maxOpenPositionsGlobal: null,
    maxConsecutiveFailures: 3,
    consecutiveFailureCount: 0,
    tradeStartTimeUtc: '14:30:00',
    tradeEndTimeUtc: '21:00:00',
    tradeWeekdaysOnly: true,
    updatedAt: new Date(),
    updatedBy: null,
    ...overrides,
  };
}

describe('isMarketOpen', () => {
  it('returns true inside the trading window on a weekday', () => {
    const rules = buildRules();
    const wednesday1500Utc = new Date('2026-06-24T15:00:00Z');
    expect(isMarketOpen(rules, wednesday1500Utc)).toBe(true);
  });

  it('returns false before the trading window opens', () => {
    const rules = buildRules();
    const wednesday1000Utc = new Date('2026-06-24T10:00:00Z');
    expect(isMarketOpen(rules, wednesday1000Utc)).toBe(false);
  });

  it('returns false after the trading window closes', () => {
    const rules = buildRules();
    const wednesday2200Utc = new Date('2026-06-24T22:00:00Z');
    expect(isMarketOpen(rules, wednesday2200Utc)).toBe(false);
  });

  it('returns false on a weekend when tradeWeekdaysOnly is true', () => {
    const rules = buildRules();
    const saturday1500Utc = new Date('2026-06-27T15:00:00Z');
    expect(isMarketOpen(rules, saturday1500Utc)).toBe(false);
  });

  it('returns true on a weekend when tradeWeekdaysOnly is false', () => {
    const rules = buildRules({ tradeWeekdaysOnly: false });
    const saturday1500Utc = new Date('2026-06-27T15:00:00Z');
    expect(isMarketOpen(rules, saturday1500Utc)).toBe(true);
  });

  it('treats the boundaries as inclusive', () => {
    const rules = buildRules();
    expect(isMarketOpen(rules, new Date('2026-06-24T14:30:00Z'))).toBe(true);
    expect(isMarketOpen(rules, new Date('2026-06-24T21:00:00Z'))).toBe(true);
  });
});
