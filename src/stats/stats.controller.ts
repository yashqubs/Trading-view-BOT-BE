import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DailyActivityQueryDto } from './dto/daily-activity-query.dto';
import {
  DailyActivityPoint,
  OverviewStats,
  StatusBreakdownPoint,
  StockActivity,
  StockStats,
} from './interfaces/stats.interfaces';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.VIEWER)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  overview(): Promise<OverviewStats> {
    return this.statsService.overview();
  }

  @Get('daily-activity')
  dailyActivity(@Query() query: DailyActivityQueryDto): Promise<DailyActivityPoint[]> {
    return this.statsService.dailyActivity(query.days);
  }

  @Get('by-stock')
  byStock(): Promise<StockActivity[]> {
    return this.statsService.byStock();
  }

  @Get('status-breakdown')
  statusBreakdown(): Promise<StatusBreakdownPoint[]> {
    return this.statsService.statusBreakdown();
  }

  @Get('stock/:ticker')
  stockDetail(@Param('ticker') ticker: string): Promise<StockStats> {
    return this.statsService.stockDetail(ticker);
  }
}
