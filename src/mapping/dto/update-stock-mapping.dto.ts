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
}
