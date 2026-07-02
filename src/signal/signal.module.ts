import { Module } from '@nestjs/common';
import { IgClientModule } from '../ig-client/ig-client.module';
import { MappingModule } from '../mapping/mapping.module';
import { TradeModule } from '../trade/trade.module';
import { TradingRulesModule } from '../trading-rules/trading-rules.module';
import { InFlightSignalTracker } from './in-flight-signal-tracker.service';
import { SignalService } from './signal.service';

@Module({
  imports: [TradingRulesModule, MappingModule, TradeModule, IgClientModule],
  providers: [SignalService, InFlightSignalTracker],
  exports: [SignalService],
})
export class SignalModule {}
