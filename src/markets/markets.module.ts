import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { Market } from './entities/market.entity';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Market, StockMapping])],
  controllers: [MarketsController],
  providers: [MarketsService],
  exports: [MarketsService, TypeOrmModule],
})
export class MarketsModule {}
