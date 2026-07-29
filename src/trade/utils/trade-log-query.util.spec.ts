import { SelectQueryBuilder } from 'typeorm';
import { Direction, TradeStatus } from '../../common/enums';
import { TradeLog } from '../entities/trade-log.entity';
import { applyTradeLogFilters } from './trade-log-query.util';

// Typed as SelectQueryBuilder<TradeLog> (not `never`, which erases .andWhere
// for the caller) via the same real-signature stand-in TypeORM query builder
// mocks use elsewhere in this codebase — a plain `{ andWhere } as never`
// return value defeats every assertion below without failing at compile time.
function fakeQb(): SelectQueryBuilder<TradeLog> & { andWhere: jest.Mock } {
  const andWhere = jest.fn().mockReturnThis();
  return { andWhere } as unknown as SelectQueryBuilder<TradeLog> & { andWhere: jest.Mock };
}

describe('applyTradeLogFilters', () => {
  it('adds no clauses when the query is empty', () => {
    const qb = fakeQb();

    applyTradeLogFilters(qb, {});

    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('filters by ticker', () => {
    const qb = fakeQb();

    applyTradeLogFilters(qb, { ticker: 'AAPL' });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.tvTicker = :ticker', { ticker: 'AAPL' });
  });

  it('filters by a single status using IN(...) — same clause shape regardless of count', () => {
    const qb = fakeQb();

    applyTradeLogFilters(qb, { status: [TradeStatus.FAILED] });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.status IN (:...statuses)', {
      statuses: [TradeStatus.FAILED],
    });
  });

  it('filters by multiple statuses — the portal default (executed only)', () => {
    const qb = fakeQb();

    applyTradeLogFilters(qb, { status: [TradeStatus.SUCCESS, TradeStatus.FAILED] });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.status IN (:...statuses)', {
      statuses: [TradeStatus.SUCCESS, TradeStatus.FAILED],
    });
  });

  it('adds no status clause for an empty array (treated as "no filter")', () => {
    const qb = fakeQb();

    applyTradeLogFilters(qb, { status: [] });

    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('filters by direction', () => {
    const qb = fakeQb();

    applyTradeLogFilters(qb, { direction: Direction.BUY });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.direction = :direction', {
      direction: Direction.BUY,
    });
  });

  it('filters by from/to independently', () => {
    const qb = fakeQb();
    const from = new Date('2026-06-01T00:00:00.000Z');
    const to = new Date('2026-06-30T23:59:59.999Z');

    applyTradeLogFilters(qb, { from, to });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.createdAt >= :from', { from });
    expect(qb.andWhere).toHaveBeenCalledWith('trade.createdAt <= :to', { to });
  });

  it('widens a bare calendar-day "to" to the end of that day', () => {
    const qb = fakeQb();
    // What the portal's "Today" preset actually sends: ?to=2026-07-29, which
    // the DTO parses as midnight. Left as midnight it excluded the whole day.
    const to = new Date('2026-07-29T00:00:00.000Z');

    applyTradeLogFilters(qb, { to });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.createdAt <= :to', {
      to: new Date('2026-07-29T23:59:59.999Z'),
    });
  });

  it('leaves an explicit timestamp "to" alone', () => {
    const qb = fakeQb();
    const to = new Date('2026-07-29T14:30:00.000Z');

    applyTradeLogFilters(qb, { to });

    expect(qb.andWhere).toHaveBeenCalledWith('trade.createdAt <= :to', { to });
  });

  it('combines every filter in one call', () => {
    const qb = fakeQb();
    const from = new Date('2026-06-01T00:00:00.000Z');

    applyTradeLogFilters(qb, {
      ticker: 'GOOG',
      status: [TradeStatus.SUCCESS, TradeStatus.FAILED],
      direction: Direction.SELL,
      from,
    });

    expect(qb.andWhere).toHaveBeenCalledTimes(4);
  });
});
