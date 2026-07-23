import { applyStatsFilters, dateRangeBounds, sinceDate } from './stats-query.util';

describe('stats-query.util', () => {
  describe('sinceDate', () => {
    it('returns a date N days in the past', () => {
      const now = Date.now();
      const since = sinceDate(7);
      const diffDays = (now - since.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThanOrEqual(6.9);
      expect(diffDays).toBeLessThanOrEqual(7.1);
    });
  });

  describe('applyStatsFilters', () => {
    it('adds ticker and days clauses when provided', () => {
      const andWhere = jest.fn().mockReturnThis();
      const qb = { andWhere } as never;

      applyStatsFilters(qb, { ticker: 'AAPL', days: 30 });

      expect(andWhere).toHaveBeenCalledWith('trade.tvTicker = :ticker', { ticker: 'AAPL' });
      expect(andWhere).toHaveBeenCalledWith('trade.createdAt >= :since', {
        since: expect.any(Date),
      });
    });

    it('adds no clauses when filter is empty', () => {
      const andWhere = jest.fn().mockReturnThis();
      const qb = { andWhere } as never;

      applyStatsFilters(qb, {});

      expect(andWhere).not.toHaveBeenCalled();
    });

    it('uses the from/to range and ignores days when both are present', () => {
      const andWhere = jest.fn().mockReturnThis();
      const qb = { andWhere } as never;

      applyStatsFilters(qb, { days: 30, from: '2026-06-01', to: '2026-06-02' });

      expect(andWhere).toHaveBeenCalledWith('trade.createdAt BETWEEN :rangeStart AND :rangeEnd', {
        rangeStart: expect.any(Date),
        rangeEnd: expect.any(Date),
      });
      expect(andWhere).not.toHaveBeenCalledWith('trade.createdAt >= :since', expect.anything());
    });
  });

  describe('dateRangeBounds', () => {
    it('returns inclusive UTC start/end of day for a single-day range', () => {
      const [start, end] = dateRangeBounds('2026-06-02', '2026-06-02');

      expect(start.toISOString()).toBe('2026-06-02T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-06-02T23:59:59.999Z');
    });

    it('throws when from is after to', () => {
      expect(() => dateRangeBounds('2026-06-05', '2026-06-01')).toThrow(
        'from must not be after to',
      );
    });

    it('throws when to is well beyond any timezone\'s "today"', () => {
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const futureStr = future.toISOString().slice(0, 10);

      expect(() => dateRangeBounds(futureStr, futureStr)).toThrow('to must not be in the future');
    });

    it('accepts UTC "tomorrow" as to — a timezone ahead of UTC (e.g. IST) sees that as today', () => {
      // Confirmed live 2026-07-24: IST (UTC+5:30) flips to a new local day
      // hours before UTC does, so the frontend's local-time "today" preset
      // legitimately lands on UTC tomorrow for part of every day.
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      expect(() => dateRangeBounds(tomorrowStr, tomorrowStr)).not.toThrow();
    });

    it('throws on a malformed date', () => {
      expect(() => dateRangeBounds('2026/06/02', '2026-06-02')).toThrow();
    });
  });
});
