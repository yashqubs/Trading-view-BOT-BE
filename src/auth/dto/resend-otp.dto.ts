import { IsEmail, IsString, MinLength } from 'class-validator';

export class ResendOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}
