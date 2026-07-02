import { IsBoolean, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class UpdateStockMappingDto {
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

  @IsOptional()
  @IsInt()
  @Min(0)
  coolDownMinutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxOpenPositions?: number;
}
