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
    investmentAmount: 500,
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

function buildPosition(
  overrides: Partial<{
    dealId: string;
    epic: string;
    direction: Direction;
    size: number;
    level: number | null;
  }> = {},
) {
  return {
    dealId: 'POS-1',
    epic: 'CS.D.AAPL.CASH.IP',
    direction: Direction.BUY,
    size: 10,
    level: 100,
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

  describe('step 5: resolve existing position — short selling (one position per ticker)', () => {
    it('skips with ALREADY_LONG when a BUY arrives while already long', async () => {
      igClientService.getOpenPositions.mockResolvedValue([
        buildPosition({ direction: Direction.BUY }),
      ]);

      const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

      expect(result.status).toBe(TradeStatus.ALREADY_LONG);
      expect(tradeService.executeTrade).not.toHaveBeenCalled();
    });

    it('skips with ALREADY_SHORT when a SELL arrives while already short', async () => {
      igClientService.getOpenPositions.mockResolvedValue([
        buildPosition({ direction: Direction.SELL }),
      ]);

      const result = await service.processSignal(buildInput({ direction: Direction.SELL }));

      expect(result.status).toBe(TradeStatus.ALREADY_SHORT);
      expect(tradeService.executeTrade).not.toHaveBeenCalled();
    });

    it('opens a short when a SELL arrives with no open position at all', async () => {
      igClientService.getOpenPositions.mockResolvedValue([]);

      const result = await service.processSignal(buildInput({ direction: Direction.SELL }));

      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(tradeService.executeTrade).toHaveBeenCalledWith(
        expect.objectContaining({ direction: Direction.SELL }),
        expect.objectContaining({ tvTicker: 'AAPL' }),
        null, // no existing position — TradeService.executeTrade opens fresh
        expect.objectContaining({ executionMode: ExecutionMode.MARKET }),
      );
    });

    it('closes an existing short when a BUY arrives', async () => {
      const shortPosition = buildPosition({ direction: Direction.SELL });
      igClientService.getOpenPositions.mockResolvedValue([shortPosition]);

      const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

      expect(result.status).toBe(TradeStatus.SUCCESS);
      expect(tradeService.executeTrade).toHaveBeenCalledWith(
        expect.objectContaining({ direction: Direction.BUY }),
        expect.objectContaining({ tvTicker: 'AAPL' }),
        shortPosition,
        expect.objectContaining({ executionMode: ExecutionMode.MARKET }),
      );
    });
  });

  it('step 6: stops with DAILY_TRADE_LIMIT on BUY when daily trade count is reached', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTradeCount: 5 }));
    tradeService.countSuccessToday.mockResolvedValue(5);

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.DAILY_TRADE_LIMIT);
  });

  it('step 6: also applies to a SELL that would open a short (opening new exposure either way)', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTradeCount: 5 }));
    tradeService.countSuccessToday.mockResolvedValue(5);
    igClientService.getOpenPositions.mockResolvedValue([]); // no position -> opening a short

    const result = await service.processSignal(buildInput({ direction: Direction.SELL }));

    expect(result.status).toBe(TradeStatus.DAILY_TRADE_LIMIT);
  });

  it('step 7: stops with DAILY_TOTAL_LIMIT on BUY when the cap would be exceeded', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTotalInvestment: 1500 }));
    tradeService.sumInvestmentSuccessToday.mockResolvedValue(1000);

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.DAILY_TOTAL_LIMIT);
  });

  it('step 7: a stock with no investmentAmount override is checked against the global default', async () => {
    tradingRulesService.get.mockResolvedValue(
      buildRules({ dailyMaxTotalInvestment: 1200, investmentAmount: 500 }),
    );
    mappingService.findByTicker.mockResolvedValue(buildMapping({ investmentAmount: null }));
    tradeService.sumInvestmentSuccessToday.mockResolvedValue(1000); // + 500 global default > 1200 cap

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.DAILY_TOTAL_LIMIT);
  });

  it('step 7: a dev-test investmentAmountOverride takes priority over both the stock and the global default', async () => {
    tradingRulesService.get.mockResolvedValue(
      buildRules({ dailyMaxTotalInvestment: 1200, investmentAmount: 500 }),
    );
    mappingService.findByTicker.mockResolvedValue(buildMapping({ investmentAmount: 50 }));
    tradeService.sumInvestmentSuccessToday.mockResolvedValue(1000);

    // Override (300) pushes the total over the 1200 cap; neither the
    // stock's own 50 nor the global 500 default would have.
    const result = await service.processSignal(
      buildInput({ direction: Direction.BUY, investmentAmountOverride: 300 }),
    );

    expect(result.status).toBe(TradeStatus.DAILY_TOTAL_LIMIT);
  });

  it('step 8: stops with STOCK_DAILY_LIMIT on BUY when the per-stock cap would be exceeded', async () => {
    mappingService.findByTicker.mockResolvedValue(buildMapping({ maxDailySpend: 1500 }));
    tradeService.sumInvestmentSuccessToday.mockResolvedValue(1000);

    const result = await service.processSignal(buildInput({ direction: Direction.BUY }));

    expect(result.status).toBe(TradeStatus.STOCK_DAILY_LIMIT);
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

  it('proceeds to execution on SELL with the matched open long position (closes it)', async () => {
    const position = buildPosition({ direction: Direction.BUY });
    igClientService.getOpenPositions.mockResolvedValue([position]);

    await service.processSignal(buildInput({ direction: Direction.SELL }));

    expect(tradeService.executeTrade).toHaveBeenCalledWith(
      expect.objectContaining({ direction: Direction.SELL }),
      expect.objectContaining({ tvTicker: 'AAPL' }),
      position,
      expect.objectContaining({ executionMode: ExecutionMode.MARKET }),
    );
  });

  it('closing an opposite-direction position bypasses the daily throttle checks', async () => {
    tradingRulesService.get.mockResolvedValue(buildRules({ dailyMaxTradeCount: 5 }));
    tradeService.countSuccessToday.mockResolvedValue(999); // would block an opening trade
    const position = buildPosition({ direction: Direction.BUY });
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
