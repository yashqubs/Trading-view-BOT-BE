import { Module } from '@nestjs/common';
import { IgClientModule } from '../ig-client/ig-client.module';
import { TradeModule } from '../trade/trade.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [IgClientModule, TradeModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
