import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { IgClientService } from '../ig-client/ig-client.service';
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
  };

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 1, ...data })),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingService,
        { provide: getRepositoryToken(StockMapping), useValue: repository },
        { provide: IgClientService, useValue: { searchMarkets: jest.fn() } },
      ],
    }).compile();

    service = module.get(MappingService);
  });

  describe('create', () => {
    it('rejects a ticker that is already mapped', async () => {
      repository.findOne.mockResolvedValue(buildMapping());

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
      repository.findOne.mockResolvedValueOnce(null); // no existing ticker
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
  });

  describe('update', () => {
    it('rejects a merged state where max daily spend is not higher than the investment', async () => {
      repository.findOne.mockResolvedValueOnce(buildMapping({ maxDailySpend: 1500 }));

      await expect(service.update(1, { investmentAmount: 1500 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
