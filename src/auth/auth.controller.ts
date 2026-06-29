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
import { AuthService, LoginChallengeResult, Setup2faResult } from './auth.service';
import { Login2faDto } from './dto/login-2fa.dto';
import { LoginDto } from './dto/login.dto';
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

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @AllowPendingSession()
  @HttpCode(HttpStatus.OK)
  setup2fa(@CurrentUser() user: AuthenticatedUser): Promise<Setup2faResult> {
    return this.authService.setup2fa(user.id);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @AllowPendingSession()
  @HttpCode(HttpStatus.OK)
  async verify2faSetup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Verify2faDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: User }> {
    const verifiedUser = await this.authService.verify2faSetup(user.id, dto, response);
    return { user: verifiedUser };
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
