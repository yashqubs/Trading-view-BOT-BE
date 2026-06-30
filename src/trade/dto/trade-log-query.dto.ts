import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { Direction, TradeStatus } from '../../common/enums';
import { SortOrder, TradeLogSortBy } from './trade-log-sort.enum';

export class TradeLogQueryDto {
  @IsOptional()
  @IsString()
  ticker?: string;

  @IsOptional()
  @IsEnum(TradeStatus)
  status?: TradeStatus;

  @IsOptional()
  @IsEnum(Direction)
  direction?: Direction;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pageSize?: number;

  @IsOptional()
  @IsEnum(TradeLogSortBy)
  sortBy?: TradeLogSortBy = TradeLogSortBy.SIGNAL_RECEIVED_AT;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}
