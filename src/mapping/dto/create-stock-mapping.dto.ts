import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
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

  @IsString()
  instrumentName: string;

  @IsString()
  instrumentType: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Omit to inherit trading_rules.investment_amount (the global default).
  @IsOptional()
  @IsNumber()
  @IsPositive()
  investmentAmount?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDailySpend?: number;

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
