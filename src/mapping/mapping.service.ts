import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgMarket } from '../ig-client/ig-client.types';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { CreateStockMappingDto } from './dto/create-stock-mapping.dto';
import { UpdateStockMappingDto } from './dto/update-stock-mapping.dto';
import { StockMapping } from './entities/stock-mapping.entity';
import { resolveInvestmentAmount } from './utils/resolve-investment-amount.util';

@Injectable()
export class MappingService {
  constructor(
    @InjectRepository(StockMapping)
    private readonly stockMappingRepository: Repository<StockMapping>,
    private readonly igClientService: IgClientService,
    private readonly tradingRulesService: TradingRulesService,
  ) {}

  findAll(): Promise<StockMapping[]> {
    return this.stockMappingRepository.find({ order: { createdAt: 'DESC' } });
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
    if (dto.maxDailySpend != null) {
      // Resolved against the current global default when this stock doesn't
      // set its own — the same "must exceed what you'll actually invest"
      // safety check either way.
      const rules = await this.tradingRulesService.get();
      const effectiveAmount = dto.investmentAmount ?? rules.investmentAmount;
      if (dto.maxDailySpend <= effectiveAmount) {
        throw new BadRequestException(
          'Max daily spend must be higher than the investment per trade',
        );
      }
    }

    const mapping = this.stockMappingRepository.create({
      tvTicker: dto.tvTicker,
      igEpic: dto.igEpic,
      instrumentName: dto.instrumentName,
      instrumentType: dto.instrumentType,
      enabled: dto.enabled ?? true,
      investmentAmount: dto.investmentAmount ?? null,
      maxDailySpend: dto.maxDailySpend ?? null,
      executionMode: dto.executionMode ?? null,
      maxSlippagePercent: dto.maxSlippagePercent ?? null,
    });

    const saved = await this.stockMappingRepository.save(mapping);
    return this.findByIdOrThrow(saved.id);
  }

  async update(id: number, dto: UpdateStockMappingDto): Promise<StockMapping> {
    const mapping = await this.findByIdOrThrow(id);

    if (dto.tvTicker !== undefined && dto.tvTicker !== mapping.tvTicker) {
      const existing = await this.findByTicker(dto.tvTicker);
      if (existing) {
        throw new BadRequestException('This ticker is already mapped');
      }
      mapping.tvTicker = dto.tvTicker;
    }
    if (dto.igEpic !== undefined) mapping.igEpic = dto.igEpic;
    if (dto.instrumentName !== undefined) mapping.instrumentName = dto.instrumentName;
    if (dto.instrumentType !== undefined) mapping.instrumentType = dto.instrumentType;
    if (dto.enabled !== undefined) mapping.enabled = dto.enabled;
    if (dto.investmentAmount !== undefined) mapping.investmentAmount = dto.investmentAmount;
    if (dto.maxDailySpend !== undefined) mapping.maxDailySpend = dto.maxDailySpend;
    if (dto.executionMode !== undefined) mapping.executionMode = dto.executionMode;
    if (dto.maxSlippagePercent !== undefined) mapping.maxSlippagePercent = dto.maxSlippagePercent;

    // Checked against the merged result (not just the fields in this dto) so
    // a change to either investmentAmount or maxDailySpend alone still
    // catches a mapping left in an invalid state by the other field. Resolved
    // against the current global default when this stock doesn't set its own.
    if (mapping.maxDailySpend != null) {
      const effectiveAmount = resolveInvestmentAmount(
        mapping,
        await this.tradingRulesService.get(),
      );
      if (mapping.maxDailySpend <= effectiveAmount) {
        throw new BadRequestException(
          'Max daily spend must be higher than the investment per trade',
        );
      }
    }

    await this.stockMappingRepository.save(mapping);
    return this.findByIdOrThrow(mapping.id);
  }

  async remove(id: number): Promise<void> {
    const mapping = await this.findByIdOrThrow(id);
    await this.stockMappingRepository.remove(mapping);
  }
}
