import { Module } from '@nestjs/common';
import { IgClientModule } from '../ig-client/ig-client.module';
import { MappingModule } from '../mapping/mapping.module';
import { TradeModule } from '../trade/trade.module';
import { TradingRulesModule } from '../trading-rules/trading-rules.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [TradeModule, TradingRulesModule, IgClientModule, MappingModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
