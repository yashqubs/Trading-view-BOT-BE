import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemService } from './system.service';
import { SystemStatus } from './system.types';

@Controller('system')
@UseGuards(JwtAuthGuard)
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('status')
  getStatus(): Promise<SystemStatus> {
    return this.systemService.getStatus();
  }
}
