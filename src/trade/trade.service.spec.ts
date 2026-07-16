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
            // Same scale as the signal price (factor 1) unless a test
            // overrides it — the points-scaling tests set their own quote.
            // No dealingRules here on purpose: tests that need the minimum
            // deal size gate set their own mock explicitly.
            getMarketDetails: jest.fn().mockResolvedValue({
              snapshot: {
                marketStatus: 'TRADEABLE',
                bid: 99.8,
                offer: 100.2,
                decimalPlacesFactor: 2,
                scalingFactor: 1,
              },
            }),
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

      // Live quote (offer 100.2) vs signal 100 -> factor 1, pricePoints 100.
      // size = 1000 / 100 = 10.00 (a £/point stake, not a share count).
      expect(igClientService.placeOrder).toHaveBeenCalledWith({
        epic: mapping.igEpic,
        direction: Direction.BUY,
        size: 10,
        orderType: 'MARKET',
      });
      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(result.dealId).toBe('DEAL-1');
      // The real £ notional actually committed: size × price-in-points.
      expect(result.tradeValue).toBe(1000);
      // The fill price IG actually confirmed, not the TradingView signal
      // price used to size the trade — orders are MARKET, so these can differ.
      expect(result.executedPrice).toBe(101.25);
      // MARKET mode applies no tolerance — recording one would imply a
      // protection that wasn't active.
      expect(result.maxSlippagePercent).toBeNull();
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

      // size = 250 / 100 = 2.50
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ size: 2.5 }),
      );
      expect(result.tradeValue).toBe(250);
    });

    it('logs FAILED (not an unhandled exception) when the computed size floors to zero', async () => {
      const tinyInvestment = { ...mapping, investmentAmount: 0.001 } as StockMapping;

      const result = await service.executeTrade(input, tinyInvestment, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.size).toBeNull();
      expect(result.tradeValue).toBeNull();
      expect(result.errorMessage).toContain('too small');
      expect(igClientService.placeOrder).not.toHaveBeenCalled();
    });

    it("logs FAILED when the computed size is positive but below IG's live minimum deal size", async () => {
      igClientService.getMarketDetails.mockResolvedValue({
        snapshot: {
          marketStatus: 'TRADEABLE',
          bid: 99.8,
          offer: 100.2,
          decimalPlacesFactor: 2,
          scalingFactor: 1,
        },
        dealingRules: { minDealSize: { value: 0.24 } },
      });
      const smallInvestment = { ...mapping, investmentAmount: 10 } as StockMapping;

      const result = await service.executeTrade(input, smallInvestment, null, rules);

      // size = 10 / 100 = 0.10, below the mocked 0.24 minimum.
      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.tradeValue).toBeNull();
      expect(result.errorMessage).toContain("IG's minimum");
      expect(result.errorMessage).toContain('£24.00');
      expect(igClientService.placeOrder).not.toHaveBeenCalled();
    });

    it('sizes off input.investmentAmountOverride when set, ignoring the mapping/rules amount entirely', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1e' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1e',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });

      const result = await service.executeTrade(
        { ...input, investmentAmountOverride: 300 },
        mapping, // mapping.investmentAmount is 1000 — must be ignored
        null,
        rules,
      );

      // size = 300 / 100 = 3.00
      expect(igClientService.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ size: 3 }));
      expect(result.tradeValue).toBe(300);
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

      const result = await service.executeTrade(input, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1,
      } as TradingRules);

      // signalPrice 100, 1% tolerance -> worst acceptable BUY price is 101.
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 101 }),
      );
      // The tolerance actually applied is recorded on the trade row.
      expect(result.maxSlippagePercent).toBe(1);
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

    it('sizes off input.executionModeOverride when set, ignoring the mapping/rules mode entirely', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1f' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1f',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });

      // Both mapping and rules say MARKET; override says SIGNAL_PRICE.
      await service.executeTrade(
        { ...input, executionModeOverride: ExecutionMode.SIGNAL_PRICE },
        mapping,
        null,
        rules,
      );

      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: input.signalPrice }),
      );
    });

    it('applies input.maxSlippagePercentOverride when set, ignoring the mapping/rules tolerance entirely', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1g' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1g',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 100,
      });

      await service.executeTrade({ ...input, maxSlippagePercentOverride: 3 }, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1, // would give 101 if not overridden
      } as TradingRules);

      // signalPrice 100, 3% tolerance (override) -> 103, not 101.
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 103 }),
      );
    });

    it('scales the LIMIT level and the size onto IG points when the market quotes 100x the signal price', async () => {
      // US share DFBs quote 1 point = 1 cent: signal $100 ↔ IG market ~10,000.
      igClientService.getMarketDetails.mockResolvedValue({
        snapshot: {
          marketStatus: 'TRADEABLE',
          bid: 10015,
          offer: 10020,
          decimalPlacesFactor: 1,
          scalingFactor: 1,
        },
      });
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1h' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1h',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 10020,
      });

      const result = await service.executeTrade(input, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1,
      } as TradingRules);

      // level = (signal 100 × factor 100) × 1.01 = 10100 — in IG points, not dollars.
      // size = investment 1000 / pricePoints 10000 = 0.10.
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 10100, size: 0.1 }),
      );
      // Filled at 10020 points → stored back on the signal scale as 100.20.
      expect(result.executedPrice).toBe(100.2);
      // Real notional: 0.10 × 10000 = 1000, matching the configured investment.
      expect(result.tradeValue).toBe(1000);
    });

    it("rounds the LIMIT level to the market's own decimalPlacesFactor", async () => {
      igClientService.getMarketDetails.mockResolvedValue({
        snapshot: {
          marketStatus: 'TRADEABLE',
          bid: 35280,
          offer: 35311,
          decimalPlacesFactor: 1, // GOOG quotes 1dp — a 2dp level could be rejected
          scalingFactor: 1,
        },
      });
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1j' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1j',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 35311,
      });

      await service.executeTrade({ ...input, signalPrice: 352.76 }, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 0.5,
      } as TradingRules);

      // 352.76 × 100 × 1.005 = 35452.38 → rounded to 1dp = 35452.4.
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 35452.4 }),
      );
    });

    it('normalizes a points-scale fill price on a MARKET order using the live-quote factor', async () => {
      igClientService.getMarketDetails.mockResolvedValue({
        snapshot: {
          marketStatus: 'TRADEABLE',
          bid: 10015,
          offer: 10020, // points market — factor 100 vs the $100 signal
          decimalPlacesFactor: 1,
          scalingFactor: 1,
        },
      });
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-1i' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-1i',
        dealStatus: 'ACCEPTED',
        status: 'OPEN',
        reason: null,
        level: 10125, // points — $101.25
      });

      const result = await service.executeTrade(input, mapping, null, rules);

      // MARKET order still goes out with no level attached…
      expect(igClientService.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'MARKET' }),
      );
      // …but the fill comes back in points and is stored on the signal scale.
      expect(result.executedPrice).toBe(101.25);
    });

    it('logs FAILED without calling IG when the signal price is implausibly far from the live market', async () => {
      // Live PayPal case 2026-07-14: market ~4687 points ($46.87), test signal
      // price 1000 — traded before this guard existed and corrupted quantity,
      // invested amount, executed price, and the slippage ceiling at once.
      igClientService.getMarketDetails.mockResolvedValue({
        snapshot: {
          marketStatus: 'TRADEABLE',
          bid: 4685,
          offer: 4687,
          decimalPlacesFactor: 1,
          scalingFactor: 1,
        },
      });

      const result = await service.executeTrade(
        { ...input, signalPrice: 1000 },
        mapping,
        null,
        rules,
      );

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toContain('implausible');
      expect(result.size).toBeNull();
      expect(result.tradeValue).toBeNull();
      expect(igClientService.placeOrder).not.toHaveBeenCalled();
    });

    it('logs FAILED when the live quote needed for a LIMIT level is unavailable', async () => {
      igClientService.getMarketDetails.mockResolvedValue({
        snapshot: {
          marketStatus: 'CLOSED',
          bid: null,
          offer: null,
          decimalPlacesFactor: 1,
          scalingFactor: 1,
        },
      });

      const result = await service.executeTrade(input, mapping, null, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1,
      } as TradingRules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('NO_LIVE_QUOTE');
      expect(igClientService.placeOrder).not.toHaveBeenCalled();
    });

    it('reconciles a SUCCESS when confirmDeal throws but a matching position actually exists on IG', async () => {
      // Confirmed live 2026-07-16: IG filled the order but confirmDeal threw
      // error.confirms.deal-not-found — this app logged FAILED while a real
      // position sat open. size 10 matches the default mapping/rules/input
      // (investment 1000, price 100, factor 1).
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-5' });
      igClientService.confirmDeal.mockRejectedValue(
        new IgApiException('error.confirms.deal-not-found'),
      );
      igClientService.getOpenPositions.mockResolvedValue([
        { dealId: 'DEAL-5', epic: mapping.igEpic, direction: Direction.BUY, size: 10, level: 101 },
      ]);

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(result.dealId).toBe('DEAL-5');
      expect(result.executedPrice).toBe(101);
      expect(tradingRulesService.resetFailureCount).toHaveBeenCalled();
    });

    it('reconciles a SUCCESS even when confirmDeal explicitly returns REJECTED, if a matching position exists', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-6' });
      igClientService.confirmDeal.mockResolvedValue({
        dealId: 'DEAL-6',
        dealStatus: 'REJECTED',
        status: null,
        reason: 'SOME_TRANSIENT_ERROR',
        level: null,
      });
      igClientService.getOpenPositions.mockResolvedValue([
        {
          dealId: 'DEAL-6b',
          epic: mapping.igEpic,
          direction: Direction.BUY,
          size: 10,
          level: 99.5,
        },
      ]);

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.SUCCESS);
      // Uses the reconciled position's own dealId/level, not confirmDeal's.
      expect(result.dealId).toBe('DEAL-6b');
      expect(result.executedPrice).toBe(99.5);
    });

    it('logs FAILED normally when confirmDeal throws and no matching position is found', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-7' });
      igClientService.confirmDeal.mockRejectedValue(
        new IgApiException('error.confirms.deal-not-found'),
      );
      igClientService.getOpenPositions.mockResolvedValue([]);

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('error.confirms.deal-not-found');
      expect(tradingRulesService.resetFailureCount).not.toHaveBeenCalled();
    });

    it('logs FAILED normally when confirmDeal throws AND the reconciliation lookup itself fails', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-8' });
      igClientService.confirmDeal.mockRejectedValue(
        new IgApiException('error.confirms.deal-not-found'),
      );
      igClientService.getOpenPositions.mockRejectedValue(new Error('IG API down'));

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.errorMessage).toBe('error.confirms.deal-not-found');
    });

    it('does not reconcile against a position with the wrong size (avoids false positives)', async () => {
      igClientService.placeOrder.mockResolvedValue({ dealReference: 'REF-9' });
      igClientService.confirmDeal.mockRejectedValue(
        new IgApiException('error.confirms.deal-not-found'),
      );
      // Same epic/direction, but a different size — must not match size:10.
      igClientService.getOpenPositions.mockResolvedValue([
        {
          dealId: 'UNRELATED',
          epic: mapping.igEpic,
          direction: Direction.BUY,
          size: 3,
          level: 101,
        },
      ]);

      const result = await service.executeTrade(input, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
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
      level: 100,
    };

    it('closes the existing position using its full size, and never sets a trade value', async () => {
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
      // Closing a position is never a new investment.
      expect(result.tradeValue).toBeNull();
      expect(result.size).toBe(10);
    });

    it('logs FAILED if executeTrade is somehow called for SELL with no position', async () => {
      const result = await service.executeTrade(sellInput, mapping, null, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.tradeValue).toBeNull();
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
      const result = await service.executeTrade(sellInputSlippage, mapping, existingPosition, {
        executionMode: ExecutionMode.SIGNAL_PRICE,
        maxSlippagePercent: 1,
      } as TradingRules);

      // signalPrice 100, 1% tolerance -> worst acceptable SELL price is 99 (a floor, not a ceiling).
      expect(igClientService.closePosition).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: 'LIMIT', level: 99 }),
      );
      expect(result.tradeValue).toBeNull();
    });

    it('reconciles a SUCCESS on SELL when confirmDeal throws but the closed position is actually gone from IG', async () => {
      igClientService.closePosition.mockResolvedValue({ dealReference: 'REF-10' });
      igClientService.confirmDeal.mockRejectedValue(
        new IgApiException('error.confirms.deal-not-found'),
      );
      // The position we tried to close (POS-1) no longer appears — closed.
      igClientService.getOpenPositions.mockResolvedValue([]);

      const result = await service.executeTrade(sellInput, mapping, existingPosition, rules);

      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(result.dealId).toBe('POS-1');
      expect(result.tradeValue).toBeNull();
    });

    it('does not reconcile a SELL as SUCCESS if the position is still open on IG', async () => {
      igClientService.closePosition.mockResolvedValue({ dealReference: 'REF-11' });
      igClientService.confirmDeal.mockRejectedValue(
        new IgApiException('error.confirms.deal-not-found'),
      );
      // POS-1 is still there — the close genuinely didn't happen.
      igClientService.getOpenPositions.mockResolvedValue([existingPosition]);

      const result = await service.executeTrade(sellInput, mapping, existingPosition, rules);

      expect(result.status).toBe(TradeStatus.FAILED);
    });
  });
});
