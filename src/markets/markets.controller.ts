import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateMarketDto } from './dto/create-market.dto';
import { UpdateMarketDto } from './dto/update-market.dto';
import { Market } from './entities/market.entity';
import { MarketsService } from './markets.service';

@Controller('markets')
@UseGuards(JwtAuthGuard)
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Get()
  findAll(): Promise<Market[]> {
    return this.marketsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Market> {
    return this.marketsService.findByIdOrThrow(id);
  }

  @Post()
  create(@Body() dto: CreateMarketDto): Promise<Market> {
    return this.marketsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMarketDto): Promise<Market> {
    return this.marketsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.marketsService.remove(id);
  }
}
