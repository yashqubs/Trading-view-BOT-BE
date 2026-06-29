import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';
import { Direction } from '../../common/enums';

export class WebhookSignalDto {
  @IsString()
  @MinLength(1)
  secret: string;

  @IsString()
  @MinLength(1)
  ticker: string;

  @IsEnum(Direction)
  action: Direction;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;
}
