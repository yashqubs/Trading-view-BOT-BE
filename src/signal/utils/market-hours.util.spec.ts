import { Market } from '../../markets/entities/market.entity';
import { isMarketOpen } from './market-hours.util';

function buildMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: 1,
    name: 'Test Market',
    timezone: 'UTC',
    openTime: '14:30',
    closeTime: '21:00',
    weekdaysOnly: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('isMarketOpen', () => {
  describe('UTC market (basic window + weekday checks)', () => {
    it('returns true inside the trading window on a weekday', () => {
      const market = buildMarket();
      const wednesday1500Utc = new Date('2026-06-24T15:00:00Z');
      expect(isMarketOpen(market, wednesday1500Utc)).toBe(true);
    });

    it('returns false before the trading window opens', () => {
      const market = buildMarket();
      const wednesday1000Utc = new Date('2026-06-24T10:00:00Z');
      expect(isMarketOpen(market, wednesday1000Utc)).toBe(false);
    });

    it('returns false after the trading window closes', () => {
      const market = buildMarket();
      const wednesday2200Utc = new Date('2026-06-24T22:00:00Z');
      expect(isMarketOpen(market, wednesday2200Utc)).toBe(false);
    });

    it('returns false on a weekend when weekdaysOnly is true', () => {
      const market = buildMarket();
      const saturday1500Utc = new Date('2026-06-27T15:00:00Z');
      expect(isMarketOpen(market, saturday1500Utc)).toBe(false);
    });

    it('returns true on a weekend when weekdaysOnly is false', () => {
      const market = buildMarket({ weekdaysOnly: false });
      const saturday1500Utc = new Date('2026-06-27T15:00:00Z');
      expect(isMarketOpen(market, saturday1500Utc)).toBe(true);
    });

    it('treats the boundaries as inclusive', () => {
      const market = buildMarket();
      expect(isMarketOpen(market, new Date('2026-06-24T14:30:00Z'))).toBe(true);
      expect(isMarketOpen(market, new Date('2026-06-24T21:00:00Z'))).toBe(true);
    });
  });

  // The whole point of using Intl over a fixed UTC offset: the SAME UTC
  // instant must resolve to a different open/closed result across a DST
  // boundary, because the market's local wall-clock time actually shifts.
  describe('DST correctness (America/New_York)', () => {
    const usMarket = buildMarket({
      name: 'US',
      timezone: 'America/New_York',
      openTime: '09:30',
      closeTime: '16:00',
    });

    it('is closed in winter (EST, UTC-5) at a UTC instant that is 09:00 local — before open', () => {
      // 2026-01-14T14:00:00Z = Wed 09:00 EST
      expect(isMarketOpen(usMarket, new Date('2026-01-14T14:00:00Z'))).toBe(false);
    });

    it('is open in summer (EDT, UTC-4) at the exact same UTC instant — now 10:00 local, inside the window', () => {
      // 2026-07-15T14:00:00Z = Wed 10:00 EDT — same UTC time-of-day as the winter case above
      expect(isMarketOpen(usMarket, new Date('2026-07-15T14:00:00Z'))).toBe(true);
    });
  });

  describe('DST correctness (Europe/London)', () => {
    const ukMarket = buildMarket({
      name: 'UK',
      timezone: 'Europe/London',
      openTime: '08:00',
      closeTime: '16:30',
    });

    it('is open in winter (GMT, UTC+0) at a UTC instant that is 16:00 local — inside the window', () => {
      // 2026-01-14T16:00:00Z = Wed 16:00 GMT
      expect(isMarketOpen(ukMarket, new Date('2026-01-14T16:00:00Z'))).toBe(true);
    });

    it('is closed in summer (BST, UTC+1) at the exact same UTC instant — now 17:00 local, after close', () => {
      // 2026-07-15T16:00:00Z = Wed 17:00 BST — same UTC time-of-day as the winter case above
      expect(isMarketOpen(ukMarket, new Date('2026-07-15T16:00:00Z'))).toBe(false);
    });
  });

  describe('no-DST timezone (Asia/Kolkata, UTC+5:30 year-round)', () => {
    const indiaMarket = buildMarket({
      name: 'India',
      timezone: 'Asia/Kolkata',
      openTime: '09:15',
      closeTime: '15:30',
    });

    it('is closed before IST open', () => {
      // 2026-06-24T03:30:00Z = Wed 09:00 IST
      expect(isMarketOpen(indiaMarket, new Date('2026-06-24T03:30:00Z'))).toBe(false);
    });

    it('is open at the exact IST open boundary', () => {
      // 2026-06-24T03:45:00Z = Wed 09:15 IST
      expect(isMarketOpen(indiaMarket, new Date('2026-06-24T03:45:00Z'))).toBe(true);
    });

    it('is open inside the IST window', () => {
      // 2026-06-24T09:00:00Z = Wed 14:30 IST
      expect(isMarketOpen(indiaMarket, new Date('2026-06-24T09:00:00Z'))).toBe(true);
    });

    it('is open at the exact IST close boundary', () => {
      // 2026-06-24T10:00:00Z = Wed 15:30 IST
      expect(isMarketOpen(indiaMarket, new Date('2026-06-24T10:00:00Z'))).toBe(true);
    });

    it('is closed after IST close', () => {
      // 2026-06-24T10:30:00Z = Wed 16:00 IST
      expect(isMarketOpen(indiaMarket, new Date('2026-06-24T10:30:00Z'))).toBe(false);
    });
  });
});
