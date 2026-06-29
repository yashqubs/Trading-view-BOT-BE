import { IsBoolean, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateStockMappingDto {
  @IsString()
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
}
