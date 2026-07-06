import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Market } from './entities/market.entity';
import { MarketsService } from './markets.service';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';

function buildMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: 1,
    name: 'UK',
    timezone: 'Europe/London',
    openTime: '08:00',
    closeTime: '16:30',
    weekdaysOnly: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MarketsService', () => {
  let service: MarketsService;
  let marketRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let stockMappingRepository: { count: jest.Mock };

  beforeEach(async () => {
    marketRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      remove: jest.fn((data) => Promise.resolve(data)),
    };
    stockMappingRepository = { count: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketsService,
        { provide: getRepositoryToken(Market), useValue: marketRepository },
        { provide: getRepositoryToken(StockMapping), useValue: stockMappingRepository },
      ],
    }).compile();

    service = module.get(MarketsService);
  });

  describe('create', () => {
    it('creates a market with defaults applied', async () => {
      marketRepository.findOne.mockResolvedValue(null);

      const result = await service.create({
        name: 'US',
        timezone: 'America/New_York',
        openTime: '09:30',
        closeTime: '16:00',
      });

      expect(result.weekdaysOnly).toBe(true);
      expect(marketRepository.save).toHaveBeenCalled();
    });

    it('rejects a duplicate name', async () => {
      marketRepository.findOne.mockResolvedValue(buildMarket());

      await expect(
        service.create({
          name: 'UK',
          timezone: 'Europe/London',
          openTime: '08:00',
          closeTime: '16:30',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('rejects renaming to a name already used by another market', async () => {
      marketRepository.findOne
        .mockResolvedValueOnce(buildMarket({ id: 1, name: 'UK' })) // findByIdOrThrow
        .mockResolvedValueOnce(buildMarket({ id: 2, name: 'US' })); // rename collision check

      await expect(service.update(1, { name: 'US' })).rejects.toThrow(BadRequestException);
    });

    it('allows updating fields without a name change', async () => {
      marketRepository.findOne.mockResolvedValueOnce(buildMarket());

      const result = await service.update(1, { openTime: '07:00' });

      expect(result.openTime).toBe('07:00');
    });

    it('throws NotFoundException for an unknown id', async () => {
      marketRepository.findOne.mockResolvedValue(null);

      await expect(service.update(999, { openTime: '07:00' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes a market with no stocks assigned', async () => {
      marketRepository.findOne.mockResolvedValue(buildMarket());
      stockMappingRepository.count.mockResolvedValue(0);

      await service.remove(1);

      expect(marketRepository.remove).toHaveBeenCalled();
    });

    it('rejects deleting a market that still has stocks assigned', async () => {
      marketRepository.findOne.mockResolvedValue(buildMarket());
      stockMappingRepository.count.mockResolvedValue(3);

      await expect(service.remove(1)).rejects.toThrow(BadRequestException);
      expect(marketRepository.remove).not.toHaveBeenCalled();
    });
  });
});
