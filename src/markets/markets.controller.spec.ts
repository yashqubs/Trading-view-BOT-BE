import { Test, TestingModule } from '@nestjs/testing';
import { Market } from './entities/market.entity';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';

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

describe('MarketsController', () => {
  let controller: MarketsController;
  let service: jest.Mocked<MarketsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketsController],
      providers: [
        {
          provide: MarketsService,
          useValue: {
            findAll: jest.fn(),
            findByIdOrThrow: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(MarketsController);
    service = module.get(MarketsService);
  });

  it('delegates findAll to the service', async () => {
    service.findAll.mockResolvedValue([buildMarket()]);

    const result = await controller.findAll();

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('delegates findOne to the service', async () => {
    service.findByIdOrThrow.mockResolvedValue(buildMarket());

    const result = await controller.findOne(1);

    expect(result.id).toBe(1);
    expect(service.findByIdOrThrow).toHaveBeenCalledWith(1);
  });

  it('delegates create to the service', async () => {
    const dto = { name: 'US', timezone: 'America/New_York', openTime: '09:30', closeTime: '16:00' };
    service.create.mockResolvedValue(buildMarket({ ...dto, id: 2 }));

    await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('delegates update to the service', async () => {
    service.update.mockResolvedValue(buildMarket({ openTime: '07:00' }));

    await controller.update(1, { openTime: '07:00' });

    expect(service.update).toHaveBeenCalledWith(1, { openTime: '07:00' });
  });

  it('delegates remove to the service', async () => {
    await controller.remove(1);

    expect(service.remove).toHaveBeenCalledWith(1);
  });
});
