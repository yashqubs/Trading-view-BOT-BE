import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Direction, ExecutionMode } from '../../common/enums';

export class TestSignalDto {
  @IsString()
  @MinLength(1)
  tvTicker: string;

  @IsEnum(Direction)
  direction: Direction;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  // Omit to use the stock's configured amount (its own override, or the
  // global default) — same resolution as a real signal. Set to size this
  // one test trade differently without touching the stock's real config.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  investmentAmount?: number;

  // Omit to use the stock's configured fill price (its own override, or the
  // global default).
  @IsOptional()
  @IsEnum(ExecutionMode)
  executionMode?: ExecutionMode;

  // Omit to use the stock's configured tolerance (its own override, or the
  // global default). Only takes effect when executionMode resolves to
  // SIGNAL_PRICE.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxSlippagePercent?: number;
}
