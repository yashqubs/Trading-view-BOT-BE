import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AllowPendingSession } from '../common/decorators/allow-pending-session.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { SessionService } from '../auth/session/session.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { CreatedUserResult, ResetPasswordResult, UserService } from './user.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
  ) {}

  @Get()
  findAll(): Promise<User[]> {
    return this.userService.findAll();
  }

  @Get('me')
  @AllowPendingSession()
  me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    return this.userService.findByIdOrThrow(user.id);
  }

  @Patch('me/password')
  @AllowPendingSession()
  async changeOwnPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const updated = await this.userService.changeOwnPassword(user.id, dto);
    // Upgrades a pending (forced-password-change) session straight to a full
    // one — without this the just-onboarded user stays stuck behind
    // JwtAuthGuard's pending check until the old cookie expires.
    await this.sessionService.establishFullSession(updated, response);
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<CreatedUserResult> {
    return this.userService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<User> {
    return this.userService.update(id, dto, currentUser.id);
  }

  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string): Promise<ResetPasswordResult> {
    return this.userService.resetPassword(id);
  }

  @Delete(':id')
  deactivate(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<User> {
    return this.userService.deactivate(id, currentUser.id);
  }
}
