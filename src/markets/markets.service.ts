import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { CreateMarketDto } from './dto/create-market.dto';
import { UpdateMarketDto } from './dto/update-market.dto';
import { Market } from './entities/market.entity';

@Injectable()
export class MarketsService {
  constructor(
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    @InjectRepository(StockMapping)
    private readonly stockMappingRepository: Repository<StockMapping>,
  ) {}

  findAll(): Promise<Market[]> {
    return this.marketRepository.find({ order: { name: 'ASC' } });
  }

  async findByIdOrThrow(id: number): Promise<Market> {
    const market = await this.marketRepository.findOne({ where: { id } });
    if (!market) {
      throw new NotFoundException('Market not found');
    }
    return market;
  }

  async create(dto: CreateMarketDto): Promise<Market> {
    const existing = await this.marketRepository.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new BadRequestException('A market with this name already exists');
    }

    const market = this.marketRepository.create({
      name: dto.name,
      timezone: dto.timezone,
      openTime: dto.openTime,
      closeTime: dto.closeTime,
      weekdaysOnly: dto.weekdaysOnly ?? true,
    });

    return this.marketRepository.save(market);
  }

  async update(id: number, dto: UpdateMarketDto): Promise<Market> {
    const market = await this.findByIdOrThrow(id);

    if (dto.name !== undefined && dto.name !== market.name) {
      const existing = await this.marketRepository.findOne({ where: { name: dto.name } });
      if (existing) {
        throw new BadRequestException('A market with this name already exists');
      }
      market.name = dto.name;
    }
    if (dto.timezone !== undefined) market.timezone = dto.timezone;
    if (dto.openTime !== undefined) market.openTime = dto.openTime;
    if (dto.closeTime !== undefined) market.closeTime = dto.closeTime;
    if (dto.weekdaysOnly !== undefined) market.weekdaysOnly = dto.weekdaysOnly;

    return this.marketRepository.save(market);
  }

  async remove(id: number): Promise<void> {
    const market = await this.findByIdOrThrow(id);

    const stocksUsingMarket = await this.stockMappingRepository.count({ where: { marketId: id } });
    if (stocksUsingMarket > 0) {
      throw new BadRequestException(
        `Cannot delete this market — ${stocksUsingMarket} stock(s) are still assigned to it. Reassign them first.`,
      );
    }

    await this.marketRepository.remove(market);
  }
}
