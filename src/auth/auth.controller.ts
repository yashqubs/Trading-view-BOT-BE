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
import { Disable2faDto } from './dto/disable-2fa.dto';
import { Login2faDto } from './dto/login-2fa.dto';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';

const LOGIN_THROTTLE = { default: { limit: 5, ttl: 900_000 } };

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

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  setup2fa(@CurrentUser() user: AuthenticatedUser): Promise<OtpSentResult> {
    return this.authService.setup2fa(user.id);
  }

  @Post('2fa/resend')
  @UseGuards(JwtAuthGuard)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  resendSetupOtp(@CurrentUser() user: AuthenticatedUser): Promise<OtpSentResult> {
    return this.authService.resendSetupOtp(user.id);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async verify2faSetup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Verify2faDto,
  ): Promise<{ user: User }> {
    const verifiedUser = await this.authService.verify2faSetup(user.id, dto);
    return { user: verifiedUser };
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
  async disable2fa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Disable2faDto,
  ): Promise<{ user: User }> {
    const updatedUser = await this.authService.disable2fa(user.id, dto);
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
    await this.authService.logout(request.cookies?.access_token, response);
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowPendingSession()
  me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    return this.userService.findByIdOrThrow(user.id);
  }
}
