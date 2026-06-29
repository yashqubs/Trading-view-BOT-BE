import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradingRules } from './entities/trading-rules.entity';
import { TradingRulesController } from './trading-rules.controller';
import { TradingRulesService } from './trading-rules.service';

@Module({
  imports: [TypeOrmModule.forFeature([TradingRules])],
  controllers: [TradingRulesController],
  providers: [TradingRulesService],
  exports: [TradingRulesService, TypeOrmModule],
})
export class TradingRulesModule {}
