import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UpdateTradingRulesDto } from './dto/update-trading-rules.dto';
import { TradingRules } from './entities/trading-rules.entity';
import { TradingRulesService } from './trading-rules.service';

@Controller('rules')
@UseGuards(JwtAuthGuard)
export class TradingRulesController {
  constructor(private readonly tradingRulesService: TradingRulesService) {}

  @Get()
  get(): Promise<TradingRules> {
    return this.tradingRulesService.get();
  }

  @Patch()
  update(
    @Body() dto: UpdateTradingRulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TradingRules> {
    return this.tradingRulesService.update(dto, user.id);
  }
}
