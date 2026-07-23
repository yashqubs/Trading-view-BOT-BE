import { BadRequestException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { TradeLog } from '../../trade/entities/trade-log.entity';

export interface StatsFilterOptions {
  days?: number;
  ticker?: string;
  from?: string;
  to?: string;
}

export interface StatsDateRangeQuery {
  days?: number;
  ticker?: string;
  from?: string;
  to?: string;
}

export function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Parses a YYYY-MM-DD string as a UTC calendar day, matching the trade_log createdAt convention. */
function parseDateBoundary(value: string, label: 'from' | 'to'): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException(`${label} must be a date in YYYY-MM-DD format`);
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label} must be a valid date`);
  }
  return date;
}

export function dateRangeBounds(from: string, to: string): [Date, Date] {
  const start = parseDateBoundary(from, 'from');
  const endDay = parseDateBoundary(to, 'to');
  const end = new Date(endDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  if (start.getTime() > endDay.getTime()) {
    throw new BadRequestException('from must not be after to');
  }

  // The frontend deliberately builds "today" from the browser's LOCAL
  // calendar day (DateRangePicker.tsx), not UTC — for timezones ahead of UTC
  // (e.g. IST, UTC+5:30) the local day flips over before UTC's does, so for
  // several hours every day a legitimate "today" preset is, in UTC terms,
  // still "tomorrow". Comparing against UTC's current day alone rejected
  // that as future (confirmed live 2026-07-24). Allowing one extra day of
  // slack covers every real-world offset (max is UTC+14) while still
  // catching genuinely bogus far-future dates.
  const maxAllowedEnd = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1,
      23,
      59,
      59,
      999,
    ),
  );
  if (end.getTime() > maxAllowedEnd.getTime()) {
    throw new BadRequestException('to must not be in the future');
  }

  return [start, end];
}

export function applyStatsFilters(
  qb: SelectQueryBuilder<TradeLog>,
  filter: StatsFilterOptions,
): SelectQueryBuilder<TradeLog> {
  if (filter.ticker) {
    qb.andWhere('trade.tvTicker = :ticker', { ticker: filter.ticker });
  }
  if (filter.from && filter.to) {
    const [start, end] = dateRangeBounds(filter.from, filter.to);
    qb.andWhere('trade.createdAt BETWEEN :rangeStart AND :rangeEnd', {
      rangeStart: start,
      rangeEnd: end,
    });
  } else if (filter.days !== undefined) {
    qb.andWhere('trade.createdAt >= :since', { since: sinceDate(filter.days) });
  }
  return qb;
}

export function toStatsFilter(query: StatsDateRangeQuery): StatsFilterOptions {
  return {
    days: query.days,
    ticker: query.ticker,
    from: query.from,
    to: query.to,
  };
}
