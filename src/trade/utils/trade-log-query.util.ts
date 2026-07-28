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
  if (query.to) qb.andWhere('trade.createdAt <= :to', { to: query.to });

  return qb;
}
