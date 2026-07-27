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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PaginatedResult } from '../common/interfaces/paginated.interface';
import { CreateStockMappingDto } from './dto/create-stock-mapping.dto';
import { SearchMarketsDto } from './dto/search-markets.dto';
import { StockMappingQueryDto } from './dto/stock-mapping-query.dto';
import { UpdateStockMappingDto } from './dto/update-stock-mapping.dto';
import { StockMapping } from './entities/stock-mapping.entity';
import { MappingService } from './mapping.service';
import { IgMarket } from '../ig-client/ig-client.types';

@Controller('mapping')
@UseGuards(JwtAuthGuard)
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  @Get()
  findAll(@Query() query: StockMappingQueryDto): Promise<PaginatedResult<StockMapping>> {
    return this.mappingService.findAllPaginated(query);
  }

  @Get('tickers')
  listTickers(): Promise<string[]> {
    return this.mappingService.listTickers();
  }

  @Get('search')
  search(@Query() query: SearchMarketsDto): Promise<IgMarket[]> {
    return this.mappingService.searchMarkets(query.term);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<StockMapping> {
    return this.mappingService.findByIdOrTickerOrThrow(id);
  }

  @Post()
  create(@Body() dto: CreateStockMappingDto): Promise<StockMapping> {
    return this.mappingService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockMappingDto,
  ): Promise<StockMapping> {
    return this.mappingService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.mappingService.remove(id);
  }
}
