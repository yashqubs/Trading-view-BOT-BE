import { Module } from '@nestjs/common';
import { IgClientModule } from '../ig-client/ig-client.module';
import { MappingModule } from '../mapping/mapping.module';
import { TradeModule } from '../trade/trade.module';
import { TradingRulesModule } from '../trading-rules/trading-rules.module';
import { SignalService } from './signal.service';

@Module({
  imports: [TradingRulesModule, MappingModule, TradeModule, IgClientModule],
  providers: [SignalService],
  exports: [SignalService],
})
export class SignalModule {}
