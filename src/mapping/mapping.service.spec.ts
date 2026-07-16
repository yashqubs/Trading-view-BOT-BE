import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { IgClientService } from '../ig-client/ig-client.service';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { StockMapping } from './entities/stock-mapping.entity';
import { MappingService } from './mapping.service';

const GLOBAL_INVESTMENT_AMOUNT = 500;

function buildMapping(overrides: Partial<StockMapping> = {}): StockMapping {
  return {
    id: 1,
    tvTicker: 'AAPL',
    igEpic: 'CS.D.AAPL.CASH.IP',
    instrumentName: 'Apple Inc',
    instrumentType: 'SHARES',
    enabled: true,
    investmentAmount: 1000,
    maxDailySpend: null,
    executionMode: null,
    maxSlippagePercent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MappingService', () => {
  let service: MappingService;
  let repository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  // findByTicker() goes through createQueryBuilder().where().getOne() (a
  // case-insensitive LOWER() comparison, not repository.findOne) — this is
  // the single knob tests use to control what "an existing ticker" resolves
  // to, defaulting to "not found" unless a test overrides it.
  let queryBuilderGetOne: jest.Mock;
  let tradingRulesService: { get: jest.Mock };

  beforeEach(async () => {
    queryBuilderGetOne = jest.fn().mockResolvedValue(null);
    repository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 1, ...data })),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getOne: queryBuilderGetOne,
      })),
    };
    tradingRulesService = {
      get: jest.fn().mockResolvedValue({ investmentAmount: GLOBAL_INVESTMENT_AMOUNT }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingService,
        { provide: getRepositoryToken(StockMapping), useValue: repository },
        { provide: IgClientService, useValue: { searchMarkets: jest.fn() } },
        { provide: TradingRulesService, useValue: tradingRulesService },
      ],
    }).compile();

    service = module.get(MappingService);
  });

  describe('create', () => {
    it('rejects a ticker that is already mapped', async () => {
      queryBuilderGetOne.mockResolvedValue(buildMapping());

      await expect(
        service.create({
          tvTicker: 'AAPL',
          igEpic: 'CS.D.AAPL.CASH.IP',
          instrumentName: 'Apple Inc',
          instrumentType: 'SHARES',
          investmentAmount: 1000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a ticker that is already mapped in a different case (case-insensitive)', async () => {
      // Real signal 2026-07-16: "SILVER" was logged NOT_MAPPED against a
      // mapping stored as "Silver" — findByTicker must not be case-sensitive.
      queryBuilderGetOne.mockResolvedValue(buildMapping({ tvTicker: 'Silver' }));

      await expect(
        service.create({
          tvTicker: 'SILVER',
          igEpic: 'CS.D.SILVER.CASH.IP',
          instrumentName: 'Silver',
          instrumentType: 'COMMODITIES',
          investmentAmount: 1000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a max daily spend that is not higher than the investment per trade', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          tvTicker: 'AAPL',
          igEpic: 'CS.D.AAPL.CASH.IP',
          instrumentName: 'Apple Inc',
          instrumentType: 'SHARES',
          investmentAmount: 1000,
          maxDailySpend: 1000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the mapping', async () => {
      // No existing ticker: queryBuilderGetOne already defaults to null.
      repository.findOne.mockResolvedValueOnce(buildMapping()); // findByIdOrThrow after save

      const result = await service.create({
        tvTicker: 'AAPL',
        igEpic: 'CS.D.AAPL.CASH.IP',
        instrumentName: 'Apple Inc',
        instrumentType: 'SHARES',
        investmentAmount: 1000,
      });

      expect(result.tvTicker).toBe('AAPL');
      expect(repository.save).toHaveBeenCalled();
    });

    it('omits investmentAmount to inherit the global default, saved as null', async () => {
      // No existing ticker: queryBuilderGetOne already defaults to null.
      repository.findOne.mockResolvedValueOnce(buildMapping({ investmentAmount: null }));

      await service.create({
        tvTicker: 'AAPL',
        igEpic: 'CS.D.AAPL.CASH.IP',
        instrumentName: 'Apple Inc',
        instrumentType: 'SHARES',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ investmentAmount: null }),
      );
    });

    it('validates maxDailySpend against the global default when investmentAmount is omitted', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          tvTicker: 'AAPL',
          igEpic: 'CS.D.AAPL.CASH.IP',
          instrumentName: 'Apple Inc',
          instrumentType: 'SHARES',
          maxDailySpend: GLOBAL_INVESTMENT_AMOUNT, // not higher than the global default
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('rejects a merged state where max daily spend is not higher than the investment', async () => {
      repository.findOne.mockResolvedValueOnce(buildMapping({ maxDailySpend: 1500 }));

      await expect(service.update(1, { investmentAmount: 1500 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when investmentAmount is cleared to null and maxDailySpend no longer exceeds the global default', async () => {
      repository.findOne.mockResolvedValueOnce(
        buildMapping({ investmentAmount: 100, maxDailySpend: 200 }),
      );

      await expect(
        service.update(1, { investmentAmount: null, maxDailySpend: GLOBAL_INVESTMENT_AMOUNT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears investmentAmount back to null to inherit the global default', async () => {
      repository.findOne.mockResolvedValueOnce(buildMapping({ investmentAmount: 1000 })); // findByIdOrThrow
      repository.findOne.mockResolvedValueOnce(buildMapping({ investmentAmount: null })); // findByIdOrThrow after save

      const result = await service.update(1, { investmentAmount: null });

      expect(result.investmentAmount).toBeNull();
    });
  });
});
