import { SelectQueryBuilder } from 'typeorm';
import { TradeLog } from '../entities/trade-log.entity';
import { TradeLogQueryDto } from '../dto/trade-log-query.dto';

/**
 * Applies GET /trades' filters (also used by /trades/export, which shares
 * the same DTO) to a query builder. Pulled out of TradeService so it's unit
 * testable against a fake `{ andWhere: jest.fn() }` the same way
 * stats-query.util's applyStatsFilters is, rather than needing a real
 * TypeORM connection.
 */
export function applyTradeLogFilters(
  qb: SelectQueryBuilder<TradeLog>,
  query: TradeLogQueryDto,
): SelectQueryBuilder<TradeLog> {
  if (query.ticker) qb.andWhere('trade.tvTicker = :ticker', { ticker: query.ticker });
  // Array so the portal's default view (SUCCESS + FAILED, hiding the noisy
  // skip reasons) and a single specific status both go through one IN(...)
  // clause — see TradeLogQueryDto.status for how a comma-separated query
  // param becomes this array.
  if (query.status?.length) {
    qb.andWhere('trade.status IN (:...statuses)', { statuses: query.status });
  }
  if (query.direction) {
    qb.andWhere('trade.direction = :direction', { direction: query.direction });
  }
  if (query.from) qb.andWhere('trade.createdAt >= :from', { from: query.from });
  if (query.to) qb.andWhere('trade.createdAt <= :to', { to: endOfDayIfDateOnly(query.to) });

  return qb;
}

/**
 * The portal sends `to` as a bare calendar day (`2026-07-29` — see
 * DateRangePicker.calcPreset), which the DTO's `@Type(() => Date)` parses as
 * the START of that day, midnight UTC. Used as-is that made `to` exclude the
 * whole day it names: the "Today" preset asked for `createdAt <= today 00:00`
 * and so returned nothing but the first instant of the day, and every other
 * preset silently dropped whatever happened on its end date (confirmed live
 * 2026-07-29 — 8 trades visible under "All time" and 0 under "Today").
 * Widening to the end of that day makes the bound inclusive, matching what
 * stats-query.util's dateRangeBounds() already does for the stats endpoints.
 *
 * Only midnight-UTC values are widened, so an explicit timestamp from an API
 * client still means exactly the instant it names.
 */
function endOfDayIfDateOnly(to: Date): Date {
  const isMidnightUtc =
    to.getUTCHours() === 0 &&
    to.getUTCMinutes() === 0 &&
    to.getUTCSeconds() === 0 &&
    to.getUTCMilliseconds() === 0;

  return isMidnightUtc ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) : to;
}
