import { Transform, Type } from 'class-transformer';
import { IsArray, IsDate, IsEnum, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { Direction, TradeStatus } from '../../common/enums';
import { SortOrder, TradeLogSortBy } from './trade-log-sort.enum';

export class TradeLogQueryDto {
  @IsOptional()
  @IsString()
  ticker?: string;

  // Accepts a single value ("FAILED") or a comma-separated list
  // ("SUCCESS,FAILED") — the portal's default "executed only" view sends the
  // list form to get both statuses in one request; picking one specific
  // status sends a bare value. Repeated query keys (?status=A&status=B, which
  // Express/Nest already hands the pipe as a string[]) are normalized the
  // same way. Empty/missing collapses to undefined so `@IsOptional` still
  // applies — "no filter", not "match nothing".
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value)
      ? value.flatMap((v) => String(v).split(','))
      : String(value).split(',');
    const cleaned = raw.map((v) => v.trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  })
  @IsArray()
  @IsEnum(TradeStatus, { each: true })
  status?: TradeStatus[];

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
