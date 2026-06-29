import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class Login2faDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsString()
  @Length(6, 10)
  code: string;
}
