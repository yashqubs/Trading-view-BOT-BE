import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgMarket } from '../ig-client/ig-client.types';
import { CreateStockMappingDto } from './dto/create-stock-mapping.dto';
import { UpdateStockMappingDto } from './dto/update-stock-mapping.dto';
import { StockMapping } from './entities/stock-mapping.entity';

@Injectable()
export class MappingService {
  constructor(
    @InjectRepository(StockMapping)
    private readonly stockMappingRepository: Repository<StockMapping>,
    private readonly igClientService: IgClientService,
  ) {}

  findAll(): Promise<StockMapping[]> {
    return this.stockMappingRepository.find({ order: { tvTicker: 'ASC' } });
  }

  async findByIdOrThrow(id: number): Promise<StockMapping> {
    const mapping = await this.stockMappingRepository.findOne({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Stock mapping not found');
    }
    return mapping;
  }

  findByTicker(tvTicker: string): Promise<StockMapping | null> {
    return this.stockMappingRepository.findOne({ where: { tvTicker } });
  }

  /** Accepts either the numeric DB id or the TradingView ticker string. */
  async findByIdOrTickerOrThrow(idOrTicker: string): Promise<StockMapping> {
    if (/^\d+$/.test(idOrTicker)) {
      return this.findByIdOrThrow(Number(idOrTicker));
    }

    const mapping = await this.findByTicker(idOrTicker);
    if (!mapping) {
      throw new NotFoundException('Stock mapping not found');
    }
    return mapping;
  }

  searchMarkets(searchTerm: string): Promise<IgMarket[]> {
    return this.igClientService.searchMarkets(searchTerm);
  }

  async create(dto: CreateStockMappingDto): Promise<StockMapping> {
    const existing = await this.findByTicker(dto.tvTicker);
    if (existing) {
      throw new BadRequestException('This ticker is already mapped');
    }

    const mapping = this.stockMappingRepository.create({
      tvTicker: dto.tvTicker,
      igEpic: dto.igEpic,
      instrumentName: dto.instrumentName,
      instrumentType: dto.instrumentType,
      enabled: dto.enabled ?? true,
      investmentAmount: dto.investmentAmount.toFixed(2),
      maxDailySpend: dto.maxDailySpend !== undefined ? dto.maxDailySpend.toFixed(2) : null,
      coolDownMinutes: dto.coolDownMinutes ?? null,
      maxOpenPositions: dto.maxOpenPositions ?? 1,
    });

    return this.stockMappingRepository.save(mapping);
  }

  async update(id: number, dto: UpdateStockMappingDto): Promise<StockMapping> {
    const mapping = await this.findByIdOrThrow(id);

    if (dto.igEpic !== undefined) mapping.igEpic = dto.igEpic;
    if (dto.instrumentName !== undefined) mapping.instrumentName = dto.instrumentName;
    if (dto.instrumentType !== undefined) mapping.instrumentType = dto.instrumentType;
    if (dto.enabled !== undefined) mapping.enabled = dto.enabled;
    if (dto.investmentAmount !== undefined)
      mapping.investmentAmount = dto.investmentAmount.toFixed(2);
    if (dto.maxDailySpend !== undefined) mapping.maxDailySpend = dto.maxDailySpend.toFixed(2);
    if (dto.coolDownMinutes !== undefined) mapping.coolDownMinutes = dto.coolDownMinutes;
    if (dto.maxOpenPositions !== undefined) mapping.maxOpenPositions = dto.maxOpenPositions;

    return this.stockMappingRepository.save(mapping);
  }

  async remove(id: number): Promise<void> {
    const mapping = await this.findByIdOrThrow(id);
    await this.stockMappingRepository.remove(mapping);
  }
}
