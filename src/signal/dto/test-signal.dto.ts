import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';
import { Direction } from '../../common/enums';

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
}
