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

export class UpdateStockMappingDto {
  // The TradingView ticker this mapping matches incoming webhook signals
  // against. Renaming it does not touch historical trade_log rows (they key
  // off the ticker string directly, not a foreign key — see clear-db.ts).
  // Trimmed + uppercased server-side — see CreateStockMappingDto.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Length(1, 20)
  tvTicker?: string;

  @IsOptional()
  @IsString()
  igEpic?: string;

  @IsOptional()
  @IsString()
  instrumentName?: string;

  @IsOptional()
  @IsString()
  instrumentType?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  investmentAmount?: number;

  // Optional AND nullable — the frontend sends `null` explicitly to clear
  // the limit back to "no limit" (EditStockModal / StockConditionsCard),
  // not just omit the field.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDailySpend?: number | null;

  // Optional AND nullable — the frontend sends `null` explicitly to revert
  // back to inheriting trading_rules.execution_mode (the global default).
  @IsOptional()
  @IsEnum(ExecutionMode)
  executionMode?: ExecutionMode | null;

  // Optional AND nullable — the frontend sends `null` explicitly to revert
  // back to inheriting trading_rules.max_slippage_percent (the global
  // default). Independent of executionMode.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxSlippagePercent?: number | null;
}
