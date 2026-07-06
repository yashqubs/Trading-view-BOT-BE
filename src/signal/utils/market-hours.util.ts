import { Market } from '../../markets/entities/market.entity';

function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Maps Intl's short weekday name to the same 0=Sun..6=Sat numbering
// Date.getUTCDay() uses, so the weekend check reads identically to before.
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Computes the wall-clock hour/minute/weekday for `at` AS OBSERVED in
 * `timeZone`, via Intl's built-in IANA tz database — correctly DST-adjusted
 * for any date, with zero extra dependencies (Node ships full-icu by
 * default since v13). `hourCycle: 'h23'` avoids the well-known Intl quirk
 * where `hour12: false` alone can still emit "24" for midnight.
 */
function localPartsInTimeZone(
  at: Date,
  timeZone: string,
): { minutesSinceMidnight: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  const minute = Number(parts.find((p) => p.type === 'minute')!.value);
  const weekdayName = parts.find((p) => p.type === 'weekday')!.value;
  return { minutesSinceMidnight: hour * 60 + minute, weekday: WEEKDAY_INDEX[weekdayName] };
}

// Assumes openTime <= closeTime within the same local day — no overnight
// sessions (not needed for UK/US/India).
export function isMarketOpen(market: Market, at: Date): boolean {
  const { minutesSinceMidnight, weekday } = localPartsInTimeZone(at, market.timezone);

  if (market.weekdaysOnly && (weekday === 0 || weekday === 6)) {
    return false;
  }

  const startMinutes = timeStringToMinutes(market.openTime);
  const endMinutes = timeStringToMinutes(market.closeTime);
  return minutesSinceMidnight >= startMinutes && minutesSinceMidnight <= endMinutes;
}
