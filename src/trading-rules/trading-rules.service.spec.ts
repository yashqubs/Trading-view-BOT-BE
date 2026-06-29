import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradingRules } from './entities/trading-rules.entity';
import { TradingRulesService } from './trading-rules.service';

describe('TradingRulesService', () => {
  let service: TradingRulesService;
  let repository: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingRulesService,
        { provide: getRepositoryToken(TradingRules), useValue: repository },
      ],
    }).compile();

    service = module.get(TradingRulesService);
  });

  describe('recordFailure', () => {
    it('increments the consecutive failure count and returns false below the threshold', async () => {
      repository.findOne.mockResolvedValue({
        consecutiveFailureCount: 0,
        maxConsecutiveFailures: 3,
      });

      const autoPaused = await service.recordFailure();

      expect(autoPaused).toBe(false);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailureCount: 1 }),
      );
    });

    it('sets bot_enabled to false and returns true once the threshold is reached', async () => {
      repository.findOne.mockResolvedValue({
        consecutiveFailureCount: 2,
        maxConsecutiveFailures: 3,
        botEnabled: true,
      });

      const autoPaused = await service.recordFailure();

      expect(autoPaused).toBe(true);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveFailureCount: 3,
          botEnabled: false,
          autoPaused: true,
        }),
      );
    });
  });

  describe('resetFailureCount', () => {
    it('resets the counter to zero when it is non-zero', async () => {
      repository.findOne.mockResolvedValue({ consecutiveFailureCount: 2 });

      await service.resetFailureCount();

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailureCount: 0 }),
      );
    });

    it('does not write when the counter is already zero', async () => {
      repository.findOne.mockResolvedValue({ consecutiveFailureCount: 0 });

      await service.resetFailureCount();

      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('creates the singleton row if it does not exist yet', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.get();

      expect(repository.create).toHaveBeenCalledWith({ id: 1 });
      expect(repository.save).toHaveBeenCalled();
    });
  });
});
