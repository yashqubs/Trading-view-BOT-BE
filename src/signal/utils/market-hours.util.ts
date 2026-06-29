import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';

function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isMarketOpen(rules: TradingRules, at: Date): boolean {
  if (rules.tradeWeekdaysOnly) {
    const utcDay = at.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (utcDay === 0 || utcDay === 6) {
      return false;
    }
  }

  const nowMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  const startMinutes = timeStringToMinutes(rules.tradeStartTimeUtc);
  const endMinutes = timeStringToMinutes(rules.tradeEndTimeUtc);

  return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
}
