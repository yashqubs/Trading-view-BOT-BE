import { Test, TestingModule } from '@nestjs/testing';
import { Direction, ExecutionMode, TradeStatus } from '../common/enums';
import { IgClientService } from '../ig-client/ig-client.service';
import { StockMapping } from '../mapping/entities/stock-mapping.entity';
import { MappingService } from '../mapping/mapping.service';
import { SignalInput } from '../trade/interfaces/signal-input.interface';
import { TradeService } from '../trade/trade.service';
import { TradingRules } from '../trading-rules/entities/trading-rules.entity';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { InFlightSignalTracker } from './in-flight-signal-tracker.service';
import { SignalService } from './signal.service';

const SIGNAL_TIME = new Date('2026-06-24T15:00:00Z');

function buildRules(overrides: Partial<TradingRules> = {}): TradingRules {
  return {
    id: 1,
    botEnabled: true,
    autoPaused: false,
    allowBuy: true,
    allowSell: true,
    dailyMaxTotalInvestment: null,
    dailyMaxTradeCount: null,
    maxConsecutiveFailures: 3,
    consecutiveFailureCount: 0,
    executionMode: ExecutionMode.MARKET,
    maxSlippagePercent: 0,
    updatedAt: new Date(),
    updatedBy: null,
    ...overrides,
  };
}

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

function buildInput(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    tvTicker: 'AAPL',
    direction: Direction.BUY,
    signalPrice: 100,
    signalReceivedAt: SIGNAL_TIME,
    ...overrides,
  };
}

describe('SignalService — condition pipeline', () => {
  let service: SignalService;
  let tradingRulesService: jest.Mocked<TradingRulesService>;
  let mappingService: jest.Mocked<MappingService>;
  let tradeService: jest.Mocked<TradeService>;
  let igClientService: jest.Mocked<IgClientService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalService,
        { provide: TradingRulesService, useValue: { get: jest.fn() } },
        { provide: MappingService, useValue: { findByTicker: jest.fn() } },
        {
          provide: TradeService,
          useValue: {
            logSkip: jest.fn((input, status) => Promise.resolve({ status })),
            executeTrade: jest.fn((input) =>
              Promise.resolve({ status: TradeStatus.SUCCESS, ...input }),
            ),
            countSuccessToday: jest.fn().mockResolvedValue(0),
            sumInvestmentSuccessToday: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: IgClientService,
          useValue: {
            getOpenPositionCount: jest.fn().mockResolvedValue(0),
            getOpenPositions: jest.fn().mockResolvedValue([]),
          },
        },
        InFlightSignalTracker,
      ],
    }).compile();

    service = module.get(SignalService);
    tradingRulesService = module.get(TradingRulesService);
    mappingService = module.get(MappingService);
    tradeService = module.get(TradeService);
    igClientService = module.get(IgClientService);

    tradingRulesService.get.mockResolvedValue(buildRules());
    mappingService.findByTicker.mockResolvedValue(buildMapping());
  });

  it('step 1: stops with BOT_PAUSED when bot_enabled is false', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ botEnabled: false }));

    const result = await service.processSignal(buildInput());

    expect(result.status).toBe(TradeStatus.BOT_PAUSED);
    expect(tradeService.executeTrade).not.toHaveBeenCalled();
  });

  it('step 2: stops with BUY_DISABLED when allow_buy is false', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ allowBuy: false }));

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.BUY_DISABLED);
  });

  it('step 2: stops with SELL_DISABLED when allow_sell is false', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ allowSell: false }));

    const result = await service.processSignal(buildInput({ direction: Direction.SELL }));

    expect(result.status).toBe(TradeStatus.SELL_DISABLED);
  });

  it('step 3: stops with NOT_MAPPED when the ticker has no mapping', async () => {
    mappingService.findByTicker.mockResolvedValue(null);

    const result = await service.processSignal(buildInput());

    expect(result.status).toBe(TradeStatus.NOT_MAPPED);
  });

  it('step 4: stops with DISABLED when the stock mapping is disabled', async () => {
    mappingService.findByTicker.mockResolvedValue(buildMapping({ enabled: false }));

    const result = await service.processSignal(buildInput());

    expect(result.status).toBe(TradeStatus.DISABLED);
  });

  it('step 5: stops with DAILY_TRADE_LIMIT on BUY when daily trade count is reached', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTradeCount: 5 }));
    tradeService.countSuccessToday.mockResolvedValue(5);

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.DAILY_TRADE_LIMIT);
  });

  it('step 6: stops with DAILY_TOTAL_LIMIT on BUY when the cap would be exceeded', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTotalInvestment: 1500 }));
    tradeService.sumInvestmentSuccessToday.mockResolvedValue(1000);

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.DAILY_TOTAL_LIMIT);
  });

  it('step 7: stops with STOCK_DAILY_LIMIT on BUY when the per-stock cap would be exceeded', async () => {
    mappingService.findByTicker.mockResolvedValue(buildMapping({ maxDailySpend: 1500 }));
    tradeService.sumInvestmentSuccessToday.mockResolvedValue(1000);

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.STOCK_DAILY_LIMIT);
  });

  it('step 8: stops with NO_POSITION on SELL when there is no open position for the epic', async () => {
    igClientService.getOpenPositions.mockResolvedValue([]);

    const result = await service.processSignal(buildInput({ direction: Direction.SELL }));

    expect(result.status).toBe(TradeStatus.NO_POSITION);
    expect(tradeService.executeTrade).not.toHaveBeenCalled();
  });

  it('proceeds to execution on BUY once every condition passes', async () => {
    await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(tradeService.executeTrade).toHaveBeenCalledWith(
      expect.objectContaining({ direction: Direction.BUY }),
      expect.objectContaining({ tvTicker: 'AAPL' }),
      null,
      expect.objectContaining({ executionMode: ExecutionMode.MARKET }),
    );
  });

  it('proceeds to execution on SELL with the matched open position', async () => {
    const position = {
      dealId: 'POS-1',
      epic: 'CS.D.AAPL.CASH.IP',
      direction: Direction.BUY,
      size: 10,
    };
    igClientService.getOpenPositions.mockResolvedValue([position]);

    await service.processSignal(buildInput({ direction: Direction.SELL }));

    expect(tradeService.executeTrade).toHaveBeenCalledWith(
      expect.objectContaining({ direction: Direction.SELL }),
      expect.objectContaining({ tvTicker: 'AAPL' }),
      position,
      expect.objectContaining({ executionMode: ExecutionMode.MARKET }),
    );
  });

  it('SELL bypasses the BUY-only throttle checks (daily limit already exhausted)', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTradeCount: 5 }));
    tradeService.countSuccessToday.mockResolvedValue(999); // would block a BUY
    const position = {
      dealId: 'POS-1',
      epic: 'CS.D.AAPL.CASH.IP',
      direction: Direction.BUY,
      size: 10,
    };
    igClientService.getOpenPositions.mockResolvedValue([position]);

    const result = await service.processSignal(buildInput({ direction: Direction.SELL }));

    expect(result.status).toBe(TradeStatus.SUCCESS);
    expect(tradeService.executeTrade).toHaveBeenCalled();
  });

  describe('duplicate signal detection', () => {
    it('skips with DUPLICATE_SIGNAL when the identical ticker/direction/price repeats within the window', async () => {
      const first = buildInput({ signalReceivedAt: new Date('2026-06-24T15:00:00.000Z') });
      const resend = buildInput({ signalReceivedAt: new Date('2026-06-24T15:00:05.000Z') }); // +5s

      await service.processSignal(first);
      const result = await service.processSignal(resend);

      expect(result.status).toBe(TradeStatus.DUPLICATE_SIGNAL);
      expect(tradeService.executeTrade).toHaveBeenCalledTimes(1);
    });

    it('processes normally once the window has elapsed', async () => {
      const first = buildInput({ signalReceivedAt: new Date('2026-06-24T15:00:00.000Z') });
      const later = buildInput({ signalReceivedAt: new Date('2026-06-24T15:00:25.000Z') }); // +25s

      await service.processSignal(first);
      const result = await service.processSignal(later);

      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(tradeService.executeTrade).toHaveBeenCalledTimes(2);
    });

    it('does not treat a different ticker as a duplicate', async () => {
      const aapl = buildInput({
        tvTicker: 'AAPL',
        signalReceivedAt: new Date('2026-06-24T15:00:00.000Z'),
      });
      const msft = buildInput({
        tvTicker: 'MSFT',
        signalReceivedAt: new Date('2026-06-24T15:00:01.000Z'),
      });
      mappingService.findByTicker.mockImplementation((ticker) =>
        Promise.resolve(buildMapping({ tvTicker: ticker })),
      );

      await service.processSignal(aapl);
      const result = await service.processSignal(msft);

      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(tradeService.executeTrade).toHaveBeenCalledTimes(2);
    });
  });
});
