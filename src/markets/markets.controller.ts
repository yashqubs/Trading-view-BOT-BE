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
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateMarketDto } from './dto/create-market.dto';
import { UpdateMarketDto } from './dto/update-market.dto';
import { Market } from './entities/market.entity';
import { MarketsService } from './markets.service';

// Reads (list/detail) are open to any authenticated role — the Add/Edit
// Stock forms need the market list regardless of role. Only mutating routes
// are ADMIN-only, matching MappingController's pattern.
@Controller('markets')
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateMarketDto): Promise<Market> {
    return this.marketsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMarketDto): Promise<Market> {
    return this.marketsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.marketsService.remove(id);
  }
}
