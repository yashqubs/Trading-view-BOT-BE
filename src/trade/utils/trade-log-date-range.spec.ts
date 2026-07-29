import 'reflect-metadata'; // the DTO's @Type decorator is read at import time
import { plainToInstance } from 'class-transformer';
import { SelectQueryBuilder } from 'typeorm';
import { TradeLogQueryDto } from '../dto/trade-log-query.dto';
import { TradeLog } from '../entities/trade-log.entity';
import { applyTradeLogFilters } from './trade-log-query.util';

/**
 * End-to-end cover for the portal's date-range presets: the exact `from`/`to`
 * query strings DateRangePicker.calcPreset produces, run through the DTO's
 * string→Date transform and into the final SQL bounds.
 *
 * The regression this locks down (confirmed live 2026-07-29): `to` arrives as
 * a bare calendar day, which parses to that day's MIDNIGHT. Used unwidened it
 * excluded the whole day it named — "Today" returned zero rows while eight
 * trades from that evening sat visible under "All time", and every other
 * preset silently dropped its own end date.
 */

function fakeQb(): SelectQueryBuilder<TradeLog> & { andWhere: jest.Mock } {
  const andWhere = jest.fn().mockReturnThis();
  return { andWhere } as unknown as SelectQueryBuilder<TradeLog> & { andWhere: jest.Mock };
}

/** Mirrors DateRangePicker.calcPreset — inclusive of both endpoints. */
function calcPreset(days: number, today: Date): { from: string; to: string } {
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: toISO(from), to: toISO(today) };
}

/** The bounds applyTradeLogFilters actually hands TypeORM. */
function boundsFor(from: string, to: string): { start: Date; end: Date } {
  const dto = plainToInstance(TradeLogQueryDto, { from, to });
  const qb = fakeQb();
  applyTradeLogFilters(qb, dto);

  const call = (clause: string) =>
    qb.andWhere.mock.calls.find(([sql]: [string]) => sql.includes(clause));

  return {
    start: call(':from')![1].from as Date,
    end: call(':to')![1].to as Date,
  };
}

describe('trade history date-range presets', () => {
  // The real scenario: trades logged 29 Jul 2026, 19:00–19:27.
  const TODAY = new Date(Date.UTC(2026, 6, 29));
  const EARLIEST_TRADE = new Date('2026-07-29T19:00:00.000Z');
  const LATEST_TRADE = new Date('2026-07-29T19:27:00.000Z');

  const PRESETS: Array<[string, number]> = [
    ['Today', 1],
    ['7D', 7],
    ['30D', 30],
    ['90D', 90],
    ['1Y', 365],
  ];

  describe.each(PRESETS)('%s', (_label, days) => {
    const { from, to } = calcPreset(days, TODAY);

    it('includes trades logged late on the end date', () => {
      const { start, end } = boundsFor(from, to);

      expect(start.getTime()).toBeLessThanOrEqual(EARLIEST_TRADE.getTime());
      expect(end.getTime()).toBeGreaterThanOrEqual(LATEST_TRADE.getTime());
    });

    it('ends at the last millisecond of the end date, not the next day', () => {
      const { end } = boundsFor(from, to);

      expect(end.toISOString()).toBe('2026-07-29T23:59:59.999Z');
    });

    it('starts at the first millisecond of the start date', () => {
      const { start } = boundsFor(from, to);

      expect(start.toISOString()).toBe(`${from}T00:00:00.000Z`);
    });

    it(`spans exactly ${days} calendar day(s)`, () => {
      const { start, end } = boundsFor(from, to);
      const spanDays = Math.round((end.getTime() + 1 - start.getTime()) / 86_400_000);

      expect(spanDays).toBe(days);
    });
  });

  it('excludes a trade from the day before the range starts', () => {
    const { from, to } = calcPreset(1, TODAY);
    const { start } = boundsFor(from, to);

    expect(new Date('2026-07-28T23:59:59.999Z').getTime()).toBeLessThan(start.getTime());
  });

  it('excludes a trade from the day after the range ends', () => {
    const { from, to } = calcPreset(7, TODAY);
    const { end } = boundsFor(from, to);

    expect(new Date('2026-07-30T00:00:00.000Z').getTime()).toBeGreaterThan(end.getTime());
  });

  it('covers a custom single-day range the same way as Today', () => {
    const { end } = boundsFor('2026-06-15', '2026-06-15');

    expect(end.toISOString()).toBe('2026-06-15T23:59:59.999Z');
  });

  it('covers a custom multi-day range', () => {
    const { start, end } = boundsFor('2026-06-01', '2026-06-30');

    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });
});
