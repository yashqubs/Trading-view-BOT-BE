import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Direction, ExecutionMode, TradeStatus } from '../common/enums';
import { IgApiException } from '../ig-client/ig-api.exception';
import { IgClientService } from '../ig-client/ig-client.service';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { TradingRules } from '../trading-rules/entities/trading-rules.entity';
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
    investmentAmount: 1000,
    maxDailySpend: null,
    executionMode: null,
    maxSlippagePercent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as StockMapping;

  const rules = { executionMode: ExecutionMode.MARKET, maxSlippagePercent: 0 } as TradingRules;

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
            getOpenPositions: jest.fn().mockResolvedValue([]),
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
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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
        level: 101.25,
      });

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(igClientService.placeOrder).toHaveBeenCalledWith({
        epic: mapping.igEpic,
        direction: Direction.BUY,
        size: 10,
        orderType: 'MARKET',
      });
      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(result.dealId).toBe('DEAL-1');
      // The fill price IG actually confirmed, not the TradingView signal
      // price used to size the trade — orders are MARKET, so these can differ.
      expect(result.executedPrice).toBe(101.25);
      expect(tradingRulesService.resetFailureCount).toHaveBeenCalled();
    });

    it('sizes the order off the global default investment when the stock has no override', async () => {
      const mappingNoOverride = { ...mapping, investmentAmount: null } as StockMapping;
      const rulesWithDefault = { ...rules, investmentAmount: 250 } as TradingRules;
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1c' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1c',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 101.25,
      });

      const result = await service.executeTrade(input, mappingNoOverride, null, rulesWithDefault);

      // quantity = 250 / 100 (signal price) = 2.5
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ size: 2.5 }),
      );
      expect(result.investmentAmount).toBe(250);
    });

    it('places a LIMIT order at the signal price when the global execution mode is SIGNAL_PRICE', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1b' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1b',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });

      await service.executeTrade(input, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 0,
      } as TradingRules);

      expect(igClientService.placeOrder).toHaveBeenCalledWith({
        epic: mapping.igEpic,
        direction: Direction.BUY,
        size: 10,
        orderType: 'LIMIT',
        level: input.signalPrice,
      });
    });

    it('applies the global slippage tolerance to the LIMIT level on a BUY', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1d' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1d',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });

      await service.executeTrade(input, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1,
      } as TradingRules);

      // signalPrice 100, 1% tolerance -> worst acceptable BUY price is 101.
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 101 }),
      );
    });

    it("a stock's own maxSlippagePercent overrides the global default independently of executionMode", async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1e' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1e',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });
      const stockSlippageOverride = { ...mapping, maxSlippagePercent: 2 } as StockMapping;

      await service.executeTrade(input, stockSlippageOverride, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1, // would give 101 if not overridden
      } as TradingRules);

      // signalPrice 100, 2% tolerance (stock override) -> 102, not 101.
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 102 }),
      );
    });

    it("a stock's own executionMode overrides the global default", async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1c' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1c',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });
      const stockOverride = {
        ...mapping,
        executionMode: ExecutionMode.SIGNAL_PRICE,
      } as StockMapping;

      // Global default is MARKET (`rules`), but the stock says SIGNAL_PRICE.
      await service.executeTrade(input, stockOverride, null, rules);

      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: input.signalPrice }),
      );
    });

    it('logs FAILED when IG rejects the deal', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-2' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-2',
        dealStatus: 'REJECTED',
        status: null,
        reason: 'INSUFFICIENT_FUNDS',
        level: null,
      });

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('INSUFFICIENT_FUNDS');
    });

    it('logs FAILED with the IG error code when placeOrder throws', async () => {
      igClientService.placeOrder.mockRejectedValue(new IgApiException('MARKET_CLOSED'));

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('MARKET_CLOSED');
    });

    it('logs an additional AUTO_PAUSED row when the failure threshold is hit', async () => {
      tradingRulesService.recordFailure.mockResolvedValue(true);
      igClientService.placeOrder.mockRejectedValue(new IgApiException('SOME_ERROR'));

      await service.executeTrade(input, mapping, null, rules);

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
        level: 108.5,
      });

      const sellInput: SignalInput = { ...input, direction: Direction.SELL, signalPrice: 110 };
      const result = await service.executeTrade(sellInput, mapping, existingPosition, rules);

      expect(igClientService.closePosition).toHaveBeenCalledWith({
        dealId: 'POS-1',
        direction: Direction.SELL,
        size: 10,
        orderType: 'MARKET',
      });
      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(result.executedPrice).toBe(108.5);
    });

    it('logs FAILED if executeTrade is somehow called for SELL with no position', async () => {
      const result = await service.executeTrade(sellInput, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(igClientService.closePosition).not.toHaveBeenCalled();
    });

    it('applies the slippage tolerance the opposite direction on a SELL (floor, not ceiling)', async () => {
      igClientService.closePosition.mockResolvedValue({ dealReference: 'REF-4' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-4',
        dealStatus: 'ACCEPTED',
        status: 'CLOSED',
        reason: null,
        level: 100,
      });

      const sellInputSlippage: SignalInput = {
        ...input,
        direction: Direction.SELL,
        signalPrice: 100,
      };
      await service.executeTrade(sellInputSlippage, mapping, existingPosition, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1,
      } as TradingRules);

      // signalPrice 100, 1% tolerance -> worst acceptable SELL price is 99 (a floor, not a ceiling).
      expect(igClientService.closePosition).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 99 }),
      );
    });
  });
});
