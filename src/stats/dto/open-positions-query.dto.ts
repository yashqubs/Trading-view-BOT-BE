import { IsOptional, IsString } from 'class-validator';

export class OpenPositionsQueryDto {
  @IsOptional()
  @IsString()
  ticker?: string;
}
