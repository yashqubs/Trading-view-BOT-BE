import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
} from 'class-validator';

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

  @IsOptional()
  @IsNumber()
  @IsPositive()
  dailyMaxTotalInvestment?: number;

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
}
