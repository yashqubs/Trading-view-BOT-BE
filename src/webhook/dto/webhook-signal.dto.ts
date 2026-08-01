import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { Direction } from '../../common/enums';

export class WebhookSignalDto {
  @IsString()
  @MinLength(1)
  secret: string;

  @IsString()
  @MinLength(1)
  ticker: string;

  @IsEnum(Direction)
  action: Direction;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  // ── Contextual fields (added to the alert template 2026-08-01) ──
  // Informational only: nothing below feeds the trading decision, the sizing
  // math, or the duplicate guard. They are declared so the payload is typed
  // and documented, and validated only as loosely as that warrants — a
  // strict rule here (@IsISO8601 on `time`, an enum on `interval`) would let
  // a cosmetic field reject a real signal, which is the wrong trade-off on
  // an endpoint whose 400s are silent trade losses.

  // TradingView `{{interval}}` — the chart timeframe the alert fired on
  // ("5", "60", "1D", …). Always a string, even for numeric timeframes.
  @IsOptional()
  @IsString()
  interval?: string;

  // TradingView `{{time}}` — the bar's open time in UTC ISO 8601. NOT used
  // as `signalReceivedAt`: that stays the server's own receipt clock, so
  // trade history reflects when we could actually have acted, not when the
  // bar opened.
  @IsOptional()
  @IsString()
  time?: string;

  // Free-text label for which strategy/indicator fired (e.g. "Profit
  // Investment") — lets the client tell alert sources apart in TradingView.
  @IsOptional()
  @IsString()
  indicator?: string;
}
