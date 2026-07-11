import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';
import { ExecutionMode } from '../../common/enums';

export class UpdateTradingRulesDto {
  @IsOptional()
  @IsBoolean()
  botEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowBuy?: boolean;

  @IsOptional()
  @IsBoolean()
  allowSell?: boolean;

  // Optional AND nullable — the frontend sends `null` explicitly to clear
  // the limit back to "no limit" (Conditions.tsx), not just omit the field.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  dailyMaxTotalInvestment?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  dailyMaxTradeCount?: number;

  // Global default investment per trade. Always required when provided —
  // unlike the daily caps, there's no "no limit" state for this one.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  investmentAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxConsecutiveFailures?: number;

  @IsOptional()
  @IsEnum(ExecutionMode)
  executionMode?: ExecutionMode;

  // Only takes effect in SIGNAL_PRICE mode. 0 = exact signal price only.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxSlippagePercent?: number;
}
