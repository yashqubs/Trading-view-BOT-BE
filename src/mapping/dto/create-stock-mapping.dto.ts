import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ExecutionMode } from '../../common/enums';

export class CreateStockMappingDto {
  // Trimmed + uppercased server-side so it exactly matches whatever ticker
  // string TradingView sends in the webhook payload — a stray space here
  // would silently make every signal for this stock miss its mapping.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Length(1, 20)
  tvTicker: string;

  @IsString()
  igEpic: string;

  // Which exchange/session this stock trades on — required, no default,
  // since there's no safe global fallback for real-world trading hours.
  @IsInt()
  @IsPositive()
  marketId: number;

  @IsString()
  instrumentName: string;

  @IsString()
  instrumentType: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsNumber()
  @IsPositive()
  investmentAmount: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDailySpend?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coolDownMinutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxOpenPositions?: number;

  // Omit to inherit trading_rules.execution_mode (the global default).
  @IsOptional()
  @IsEnum(ExecutionMode)
  executionMode?: ExecutionMode;

  // Omit to inherit trading_rules.max_slippage_percent (the global default).
  // Independent of executionMode.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxSlippagePercent?: number;
}
