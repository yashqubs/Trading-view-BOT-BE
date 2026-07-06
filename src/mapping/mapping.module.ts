import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IgClientModule } from '../ig-client/ig-client.module';
import { MarketsModule } from '../markets/markets.module';
import { StockMapping } from './entities/stock-mapping.entity';
import { MappingController } from './mapping.controller';
import { MappingService } from './mapping.service';

@Module({
  imports: [TypeOrmModule.forFeature([StockMapping]), IgClientModule, MarketsModule],
  controllers: [MappingController],
  providers: [MappingService],
  exports: [MappingService, TypeOrmModule],
})
export class MappingModule {}
