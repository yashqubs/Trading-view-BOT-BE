import { Injectable, Logger } from '@nestjs/common';
import { Direction, TradeStatus } from '../common/enums';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgPosition } from '../ig-client/ig-client.types';
import { MappingService } from '../mapping/mapping.service';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { SignalInput } from '../trade/interfaces/signal-input.interface';
import { TradeService } from '../trade/trade.service';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { InFlightSignalTracker } from './in-flight-signal-tracker.service';
import { isMarketOpen } from './utils/market-hours.util';

/**
 * Orchestrates the documented 15-step condition pipeline
 * (PROJECT_DOCUMENTATION.md Section 9). Order must never change.
 *
 * Design note on steps 6,7,8,9,10,11 (the throttle checks — daily trade
 * count, daily investment caps, global/per-stock position caps, cool-down):
 * these exist to limit how much NEW exposure the bot opens. They are applied
 * to BUY signals only. A SELL signal is always a request to close existing
 * exposure, and CLAUDE.md's mandatory rule is that the SELL position check
 * (step 12) is "not optional" — blocking a close because a daily cap or
 * cool-down was hit would leave unwanted exposure open, which is the unsafe
 * outcome the throttles are meant to prevent in the first place. SELL signals
 * therefore go: 1-5 (kill switch / mapping / market hours guards, which are
 * legitimate even for closes) straight to 12 (position check) then execute.
 */
// TradingView can resend the exact same webhook alert on delivery retry. The
// payload carries no alert ID or TradingView-supplied timestamp to key off
// (see WebhookSignalDto), so an identical ticker+direction+price arriving
// again within this window is treated as a resend, not a new signal. Long
// enough to catch a delivery retry; short enough that the same ticker/
// direction/price legitimately recurring later the same day still executes.
const DUPLICATE_SIGNAL_WINDOW_MS = 20_000;

@Injectable()
export class SignalService {
  private readonly logger = new Logger(SignalService.name);

  // In-memory only — safe because this app runs as a single PM2 fork instance
  // (see ecosystem.config.js); a second process would need a shared store.
  private readonly recentSignals = new Map<string, number>();

  constructor(
    private readonly tradingRulesService: TradingRulesService,
    private readonly mappingService: MappingService,
    private readonly tradeService: TradeService,
    private readonly igClientService: IgClientService,
    private readonly inFlightSignalTracker: InFlightSignalTracker,
  ) {}

  // Thin wrapper so InFlightSignalTracker sees every entry/exit of the
  // pipeline below (all its early returns included) without touching the
  // pipeline itself — see in-flight-signal-tracker.service.ts for why this
  // matters (SIGTERM during a deploy must not kill a signal mid-execution).
  async processSignal(input: SignalInput): Promise<TradeLog> {
    this.inFlightSignalTracker.begin();
    try {
      return await this.runPipeline(input);
    } finally {
      this.inFlightSignalTracker.end();
    }
  }

  private async runPipeline(input: SignalInput): Promise<TradeLog> {
    // Not one of the documented 15 pipeline steps — a technical safeguard
    // against re-processing the same webhook delivery, checked ahead of them.
    if (this.isDuplicateSignal(input)) {
      return this.tradeService.logSkip(input, TradeStatus.DUPLICATE_SIGNAL);
    }

    const rules = await this.tradingRulesService.get();

    // 1. bot_enabled
    if (!rules.botEnabled) {
      return this.tradeService.logSkip(input, TradeStatus.BOT_PAUSED);
    }

    // 2. direction allowed
    if (input.direction === Direction.BUY && !rules.allowBuy) {
      return this.tradeService.logSkip(input, TradeStatus.BUY_DISABLED);
    }
    if (input.direction === Direction.SELL && !rules.allowSell) {
      return this.tradeService.logSkip(input, TradeStatus.SELL_DISABLED);
    }

    // 3. ticker in mapping
    const mapping = await this.mappingService.findByTicker(input.tvTicker);
    if (!mapping) {
      return this.tradeService.logSkip(input, TradeStatus.NOT_MAPPED);
    }

    // 4. stock enabled
    if (!mapping.enabled) {
      return this.tradeService.logSkip(input, TradeStatus.DISABLED, mapping.igEpic);
    }

    // 5. market open (the stock's OWN assigned market, not a global window)
    if (!isMarketOpen(mapping.market, input.signalReceivedAt)) {
      return this.tradeService.logSkip(input, TradeStatus.MARKET_CLOSED, mapping.igEpic);
    }

    if (input.direction === Direction.BUY) {
      // 6. daily trade count
      if (rules.dailyMaxTradeCount !== null) {
        const tradeCountToday = await this.tradeService.countSuccessToday();
        if (tradeCountToday >= rules.dailyMaxTradeCount) {
          return this.tradeService.logSkip(input, TradeStatus.DAILY_TRADE_LIMIT, mapping.igEpic);
        }
      }

      // 7. daily total investment
      if (rules.dailyMaxTotalInvestment !== null) {
        const investedToday = await this.tradeService.sumInvestmentSuccessToday();
        const wouldBeInvested = investedToday + Number(mapping.investmentAmount);
        if (wouldBeInvested > Number(rules.dailyMaxTotalInvestment)) {
          return this.tradeService.logSkip(input, TradeStatus.DAILY_TOTAL_LIMIT, mapping.igEpic);
        }
      }

      // 8 & 11 both need the current open positions — step 11 runs
      // unconditionally for every BUY, so fetching once here (rather than
      // once per check) never does an unnecessary IG call.
      const openPositions = await this.igClientService.getOpenPositions();

      // 8. global open positions
      if (rules.maxOpenPositionsGlobal !== null) {
        if (openPositions.length >= rules.maxOpenPositionsGlobal) {
          return this.tradeService.logSkip(
            input,
            TradeStatus.GLOBAL_POSITION_LIMIT,
            mapping.igEpic,
          );
        }
      }

      // 9. stock cool-down
      if (mapping.coolDownMinutes !== null) {
        const lastTrade = await this.tradeService.getLastSuccessfulTrade(mapping.tvTicker);
        if (lastTrade) {
          const elapsedMinutes =
            (input.signalReceivedAt.getTime() - lastTrade.createdAt.getTime()) / 60_000;
          if (elapsedMinutes < mapping.coolDownMinutes) {
            return this.tradeService.logSkip(input, TradeStatus.COOL_DOWN, mapping.igEpic);
          }
        }
      }

      // 10. stock daily spend
      if (mapping.maxDailySpend !== null) {
        const investedTodayForStock = await this.tradeService.sumInvestmentSuccessToday(
          mapping.tvTicker,
        );
        const wouldBeInvested = investedTodayForStock + Number(mapping.investmentAmount);
        if (wouldBeInvested > Number(mapping.maxDailySpend)) {
          return this.tradeService.logSkip(input, TradeStatus.STOCK_DAILY_LIMIT, mapping.igEpic);
        }
      }

      // 11. stock max open positions
      const stockPositionCount = openPositions.filter(
        (position) => position.epic === mapping.igEpic,
      ).length;
      if (stockPositionCount >= mapping.maxOpenPositions) {
        return this.tradeService.logSkip(input, TradeStatus.MAX_POSITIONS_STOCK, mapping.igEpic);
      }
    }

    // 12. SELL must have an open position
    let existingPosition: IgPosition | null = null;
    if (input.direction === Direction.SELL) {
      const positions = await this.igClientService.getOpenPositions();
      existingPosition = positions.find((position) => position.epic === mapping.igEpic) ?? null;
      if (!existingPosition) {
        return this.tradeService.logSkip(input, TradeStatus.NO_POSITION, mapping.igEpic);
      }
    }

    // 13-15. calculate quantity, execute on IG, log SUCCESS/FAILED, handle failure counter
    this.logger.log(`Executing ${input.direction} for ${input.tvTicker} @ ${input.signalPrice}`);
    return this.tradeService.executeTrade(input, mapping, existingPosition, rules);
  }

  private isDuplicateSignal(input: SignalInput): boolean {
    const key = `${input.tvTicker}:${input.direction}:${input.signalPrice}`;
    const now = input.signalReceivedAt.getTime();
    this.pruneExpiredSignals(now);

    const lastSeenAt = this.recentSignals.get(key);
    this.recentSignals.set(key, now);
    return lastSeenAt !== undefined && now - lastSeenAt < DUPLICATE_SIGNAL_WINDOW_MS;
  }

  private pruneExpiredSignals(now: number): void {
    for (const [key, seenAt] of this.recentSignals) {
      if (now - seenAt >= DUPLICATE_SIGNAL_WINDOW_MS) {
        this.recentSignals.delete(key);
      }
    }
  }
}
