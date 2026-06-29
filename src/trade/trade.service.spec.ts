import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Direction, TradeStatus } from '../common/enums';
import { IgApiException } from '../ig-client/ig-api.exception';
import { IgClientService } from '../ig-client/ig-client.service';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { TradeLog } from './entities/trade-log.entity';
import { SignalInput } from './interfaces/signal-input.interface';
import { TradeService } from './trade.service';

describe('TradeService', () => {
  let service: TradeService;
  let igClientService: jest.Mocked<IgClientService>;
  let tradingRulesService: jest.Mocked<TradingRulesService>;
  let tradeLogRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    count: jest.Mock;
    findOne: jest.Mock;
  };

  const input: SignalInput = {
    tvTicker: 'AAPL',
    direction: Direction.BUY,
    signalPrice: 100,
    signalReceivedAt: new Date('2026-06-24T15:00:00Z'),
  };

  const mapping = {
    id: 1,
    tvTicker: 'AAPL',
    igEpic: 'CS.D.AAPL.CASH.IP',
    instrumentName: 'Apple Inc',
    instrumentType: 'SHARES',
    enabled: true,
    investmentAmount: '1000.00',
    maxDailySpend: null,
    coolDownMinutes: null,
    maxOpenPositions: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as StockMapping;

  beforeEach(async () => {
    tradeLogRepository = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 1, ...data })),
      createQueryBuilder: jest.fn(),
      count: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeService,
        { provide: getRepositoryToken(TradeLog), useValue: tradeLogRepository },
        {
          provide: IgClientService,
          useValue: {
            placeOrder: jest.fn(),
            closePosition: jest.fn(),
            confirmDeal: jest.fn(),
            getOpenPositions: jest.fn(),
            getOpenPositionCount: jest.fn(),
          },
        },
        {
          provide: TradingRulesService,
          useValue: {
            recordFailure: jest.fn().mockResolvedValue(false),
            resetFailureCount: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(TradeService);
    igClientService = module.get(IgClientService);
    tradingRulesService = module.get(TradingRulesService);
  });

  describe('logSkip', () => {
    it('writes a trade_log row with the given status as skipReason', async () => {
      const result = await service.logSkip(input, TradeStatus.BOT_PAUSED);

      expect(tradeLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tvTicker: 'AAPL',
          status: TradeStatus.BOT_PAUSED,
          skipReason: TradeStatus.BOT_PAUSED,
        }),
      );
      expect(result.status).toBe(TradeStatus.BOT_PAUSED);
    });
  });

  describe('executeTrade — BUY', () => {
    it('places an order and logs SUCCESS when IG accepts the deal', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
      });

      const result = await service.executeTrade(input, mapping, null);

      expect(igClientService.placeOrder).toHaveBeenCalledWith({
        epic: mapping.igEpic,
        direction: Direction.BUY,
        size: 10,
      });
      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(result.dealId).toBe('DEAL-1');
      expect(tradingRulesService.resetFailureCount).toHaveBeenCalled();
    });

    it('logs FAILED when IG rejects the deal', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-2' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-2',
        dealStatus: 'REJECTED',
        status: null,
        reason: 'INSUFFICIENT_FUNDS',
      });

      const result = await service.executeTrade(input, mapping, null);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('INSUFFICIENT_FUNDS');
    });

    it('logs FAILED with the IG error code when placeOrder throws', async () => {
      igClientService.placeOrder.mockRejectedValue(new IgApiException('MARKET_CLOSED'));

      const result = await service.executeTrade(input, mapping, null);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('MARKET_CLOSED');
    });

    it('logs an additional AUTO_PAUSED row when the failure threshold is hit', async () => {
      tradingRulesService.recordFailure.mockResolvedValue(true);
      igClientService.placeOrder.mockRejectedValue(new IgApiException('SOME_ERROR'));

      await service.executeTrade(input, mapping, null);

      const statuses = tradeLogRepository.save.mock.calls.map((call) => call[0].status);
      expect(statuses).toEqual([TradeStatus.FAILED, TradeStatus.AUTO_PAUSED]);
    });
  });

  describe('executeTrade — SELL', () => {
    const sellInput: SignalInput = { ...input, direction: Direction.SELL };
    const existingPosition = {
      dealId: 'POS-1',
      epic: mapping.igEpic,
      direction: Direction.BUY,
      size: 10,
    };

    it('closes the existing position using its full size', async () => {
      igClientService.closePosition.mockResolvedValue({ dealReference: 'REF-3' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-3',
        dealStatus: 'ACCEPTED',
        status: 'CLOSED',
        reason: null,
      });

      const result = await service.executeTrade(sellInput, mapping, existingPosition);

      expect(igClientService.closePosition).toHaveBeenCalledWith({
        dealId: 'POS-1',
        direction: Direction.SELL,
        size: 10,
      });
      expect(result.status).toBe(TradeStatus.SUCCESS);
    });

    it('logs FAILED if executeTrade is somehow called for SELL with no position', async () => {
      const result = await service.executeTrade(sellInput, mapping, null);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(igClientService.closePosition).not.toHaveBeenCalled();
    });
  });
});
