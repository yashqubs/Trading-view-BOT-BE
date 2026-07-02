import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SystemService } from './system.service';
import { SystemStatus } from './system.types';

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.VIEWER)
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('status')
  getStatus(): Promise<SystemStatus> {
    return this.systemService.getStatus();
  }
}
