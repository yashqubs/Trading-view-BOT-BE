import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IgClientModule } from '../ig-client/ig-client.module';
import { MappingModule } from '../mapping/mapping.module';
import { TradingRulesModule } from '../trading-rules/trading-rules.module';
import { TradeLog } from './entities/trade-log.entity';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeLog]),
    IgClientModule,
    MappingModule,
    TradingRulesModule,
  ],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService, TypeOrmModule],
})
export class TradeModule {}
