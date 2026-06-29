import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TradeLogQueryDto } from './dto/trade-log-query.dto';
import { PaginatedTradeLogs, TradeService } from './trade.service';
import { tradeLogsToCsv } from './utils/trade-log-csv.util';

@Controller('trades')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.VIEWER)
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Get()
  findAll(@Query() query: TradeLogQueryDto): Promise<PaginatedTradeLogs> {
    return this.tradeService.findAll(query);
  }

  @Get('export')
  async exportCsv(@Query() query: TradeLogQueryDto, @Res() response: Response): Promise<void> {
    const trades = await this.tradeService.findAllForExport(query);
    const csv = tradeLogsToCsv(trades);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    response.send(csv);
  }
}
