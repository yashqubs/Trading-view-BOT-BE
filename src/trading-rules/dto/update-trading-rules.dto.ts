import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ExecutionMode } from '../../common/enums';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

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

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxOpenPositionsGlobal?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxConsecutiveFailures?: number;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  tradeStartTimeUtc?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  tradeEndTimeUtc?: string;

  @IsOptional()
  @IsBoolean()
  tradeWeekdaysOnly?: boolean;

  @IsOptional()
  @IsEnum(ExecutionMode)
  executionMode?: ExecutionMode;
}
