import { IsBoolean, IsOptional, IsString, IsTimeZone, Length, Matches } from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

export class UpdateMarketDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  openTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  closeTime?: string;

  @IsOptional()
  @IsBoolean()
  weekdaysOnly?: boolean;
}
