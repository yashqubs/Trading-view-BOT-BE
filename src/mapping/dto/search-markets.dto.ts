import { IsString, MinLength } from 'class-validator';

export class SearchMarketsDto {
  @IsString()
  @MinLength(1)
  term: string;
}
