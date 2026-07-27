import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { PaginatedResult } from '../common/interfaces/paginated.interface';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgMarket } from '../ig-client/ig-client.types';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { CreateStockMappingDto } from './dto/create-stock-mapping.dto';
import { StockMappingQueryDto } from './dto/stock-mapping-query.dto';
import { SortOrder, StockMappingSortBy } from './dto/stock-mapping-sort.enum';
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

  listTickers(): Promise<string[]> {
    return this.stockMappingRepository
      .find({ select: ['tvTicker'], order: { tvTicker: 'ASC' } })
      .then((rows) => rows.map((row) => row.tvTicker));
  }

  async findAllPaginated(query: StockMappingQueryDto): Promise<PaginatedResult<StockMapping>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const countQb = this.buildFilteredQuery(query);
    const total = await countQb.getCount();

    const itemsQb = this.buildFilteredQuery(query);
    await this.applySort(itemsQb, query);
    itemsQb.skip((page - 1) * pageSize).take(pageSize);

    const items = await itemsQb.getMany();
    return { items, total };
  }

  private buildFilteredQuery(query: StockMappingQueryDto): SelectQueryBuilder<StockMapping> {
    const qb = this.stockMappingRepository.createQueryBuilder('mapping');

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(mapping.tvTicker) LIKE :term OR LOWER(mapping.instrumentName) LIKE :term)',
        { term },
      );
    }

    if (query.enabled !== undefined) {
      qb.andWhere('mapping.enabled = :enabled', { enabled: query.enabled });
    }

    return qb;
  }

  private async applySort(
    qb: SelectQueryBuilder<StockMapping>,
    query: StockMappingQueryDto,
  ): Promise<void> {
    const sortBy = query.sortBy ?? StockMappingSortBy.CREATED_AT;
    const sortOrder = (query.sortOrder ?? SortOrder.DESC).toUpperCase() as 'ASC' | 'DESC';

    switch (sortBy) {
      case StockMappingSortBy.TV_TICKER:
        qb.orderBy('mapping.tvTicker', sortOrder);
        return;
      case StockMappingSortBy.INVESTMENT_AMOUNT: {
        const rules = await this.tradingRulesService.get();
        qb.orderBy('COALESCE(mapping.investment_amount, :defaultInvestment)', sortOrder).setParameter(
          'defaultInvestment',
          rules.investmentAmount,
        );
        return;
      }
      case StockMappingSortBy.MAX_DAILY_SPEND:
        qb.orderBy('mapping.max_daily_spend', sortOrder, 'NULLS LAST');
        return;
      case StockMappingSortBy.CREATED_AT:
      default:
        qb.orderBy('mapping.created_at', sortOrder);
    }
  }

  async findByIdOrThrow(id: number): Promise<StockMapping> {
    const mapping = await this.stockMappingRepository.findOne({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Stock mapping not found');
    }
    return mapping;
  }

  // Case-insensitive on purpose: TradingView alerts, IG search results, and
  // manual entry all vary in casing (SILVER vs Silver vs silver), and a
  // ticker that's genuinely mapped shouldn't fail with NOT_MAPPED just
  // because the casing doesn't match byte-for-byte. Uses a parameterized
  // LOWER() comparison (TypeORM query builder), never a raw string.
  findByTicker(tvTicker: string): Promise<StockMapping | null> {
    return this.stockMappingRepository
      .createQueryBuilder('mapping')
      .where('LOWER(mapping.tvTicker) = LOWER(:tvTicker)', { tvTicker })
      .getOne();
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
