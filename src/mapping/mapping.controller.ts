import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateStockMappingDto } from './dto/create-stock-mapping.dto';
import { SearchMarketsDto } from './dto/search-markets.dto';
import { UpdateStockMappingDto } from './dto/update-stock-mapping.dto';
import { StockMapping } from './entities/stock-mapping.entity';
import { MappingService } from './mapping.service';
import { IgMarket } from '../ig-client/ig-client.types';

// Reads (list/detail) are open to any authenticated role — VIEWER pages
// (Dashboard's ticker filter, the stock detail page) depend on them. Only
// the mutating routes (create/update/delete/IG search) are ADMIN-only,
// matching the TradingRulesController GET-open/PATCH-restricted pattern.
@Controller('mapping')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  @Get()
  findAll(): Promise<StockMapping[]> {
    return this.mappingService.findAll();
  }

  @Get('search')
  @Roles(UserRole.ADMIN)
  search(@Query() query: SearchMarketsDto): Promise<IgMarket[]> {
    return this.mappingService.searchMarkets(query.term);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<StockMapping> {
    return this.mappingService.findByIdOrTickerOrThrow(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateStockMappingDto): Promise<StockMapping> {
    return this.mappingService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockMappingDto,
  ): Promise<StockMapping> {
    return this.mappingService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.mappingService.remove(id);
  }
}
