import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AllowPendingSession } from '../common/decorators/allow-pending-session.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthService, LoginChallengeResult, OtpSentResult } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { Login2faDto } from './dto/login-2fa.dto';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';

const LOGIN_THROTTLE = { default: { limit: 5, ttl: 900_000 } };

// Refresh is not a brute-forceable credential entry point (the token is an
// opaque 256-bit value), and legitimate traffic is bursty: every open tab
// refreshes when the 15-minute access token lapses, plus page reloads. The
// login limit of 5/15min is far too tight for that — one user with a few
// tabs would trip it and get logged out mid-session.
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 900_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('login')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginChallengeResult> {
    return this.authService.login(dto, response);
  }

  @Post('login/2fa')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async loginWith2fa(
    @Body() dto: Login2faDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: User }> {
    const user = await this.authService.loginWith2fa(dto, response);
    return { user };
  }

  @Post('login/2fa/resend')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  resendLoginOtp(@Body() dto: ResendOtpDto): Promise<OtpSentResult> {
    return this.authService.resendLoginOtp(dto);
  }

  // Deliberately the same response whether or not the email is registered —
  // see AuthService.requestPasswordReset for why. Throttled at the same rate
  // as login so it can't be used to mass-email accounts either.
  @Post('forgot-password')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    return { message: 'If that email is registered, we have sent a verification code.' };
  }

  @Post('reset-password')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPasswordWithCode(dto);
    return { message: 'Password updated. You can now sign in with your new password.' };
  }

  // Enable/disable are plain authenticated toggles — no OTP or password
  // confirmation, by product decision (see AuthService.enable2fa).
  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async enable2fa(@CurrentUser() user: AuthenticatedUser): Promise<{ user: User }> {
    const updatedUser = await this.authService.enable2fa(user.id);
    return { user: updatedUser };
  }

  @Post('2fa/skip')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async skip2fa(@CurrentUser() user: AuthenticatedUser): Promise<{ user: User }> {
    const currentUser = await this.authService.skip2fa(user.id);
    return { user: currentUser };
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disable2fa(@CurrentUser() user: AuthenticatedUser): Promise<{ user: User }> {
    const updatedUser = await this.authService.disable2fa(user.id);
    return { user: updatedUser };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @AllowPendingSession()
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    await this.authService.logout(
      request.cookies?.access_token,
      request.cookies?.refresh_token,
      response,
    );
    return { success: true };
  }

  // Deliberately NOT behind JwtAuthGuard — this exists specifically for the
  // case where the access token has already expired. Silent renewal while
  // the user stays active; the refresh cookie is opaque and has its own
  // sliding idle timeout (see RefreshTokenService).
  @Post('refresh')
  @Throttle(REFRESH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: User }> {
    const user = await this.authService.refresh(request.cookies?.refresh_token, response);
    return { user };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowPendingSession()
  me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    return this.userService.findByIdOrThrow(user.id);
  }
}
