import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { IgClientService } from '../ig-client/ig-client.service';
import { MarketsService } from '../markets/markets.service';
import { StockMapping } from './entities/stock-mapping.entity';
import { MappingService } from './mapping.service';

function buildMapping(overrides: Partial<StockMapping> = {}): StockMapping {
  return {
    id: 1,
    tvTicker: 'AAPL',
    igEpic: 'CS.D.AAPL.CASH.IP',
    instrumentName: 'Apple Inc',
    instrumentType: 'SHARES',
    enabled: true,
    marketId: 1,
    market: undefined as never,
    investmentAmount: 1000,
    maxDailySpend: null,
    coolDownMinutes: null,
    maxOpenPositions: 1,
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
  };
  let marketsService: { findByIdOrThrow: jest.Mock };

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 1, ...data })),
      remove: jest.fn(),
    };
    marketsService = { findByIdOrThrow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingService,
        { provide: getRepositoryToken(StockMapping), useValue: repository },
        { provide: IgClientService, useValue: { searchMarkets: jest.fn() } },
        { provide: MarketsService, useValue: marketsService },
      ],
    }).compile();

    service = module.get(MappingService);
  });

  describe('create', () => {
    it('rejects an unknown marketId with a 404 instead of a raw FK error', async () => {
      repository.findOne.mockResolvedValue(null); // no existing ticker
      marketsService.findByIdOrThrow.mockRejectedValue(new NotFoundException('Market not found'));

      await expect(
        service.create({
          tvTicker: 'AAPL',
          igEpic: 'CS.D.AAPL.CASH.IP',
          instrumentName: 'Apple Inc',
          instrumentType: 'SHARES',
          marketId: 999,
          investmentAmount: 1000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates the mapping when the marketId is valid', async () => {
      repository.findOne.mockResolvedValueOnce(null); // no existing ticker
      marketsService.findByIdOrThrow.mockResolvedValue({ id: 1 });
      repository.findOne.mockResolvedValueOnce(buildMapping()); // findByIdOrThrow after save

      const result = await service.create({
        tvTicker: 'AAPL',
        igEpic: 'CS.D.AAPL.CASH.IP',
        instrumentName: 'Apple Inc',
        instrumentType: 'SHARES',
        marketId: 1,
        investmentAmount: 1000,
      });

      expect(result.marketId).toBe(1);
      expect(marketsService.findByIdOrThrow).toHaveBeenCalledWith(1);
    });
  });

  describe('update', () => {
    it('rejects reassigning to an unknown marketId', async () => {
      repository.findOne.mockResolvedValueOnce(buildMapping()); // findByIdOrThrow
      marketsService.findByIdOrThrow.mockRejectedValue(new NotFoundException('Market not found'));

      await expect(service.update(1, { marketId: 999 })).rejects.toThrow(NotFoundException);
    });
  });
});
