import { Injectable, Logger } from '@nestjs/common';
import { Direction, TradeStatus } from '../common/enums';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgPosition } from '../ig-client/ig-client.types';
import { MappingService } from '../mapping/mapping.service';
import { resolveInvestmentAmount } from '../mapping/utils/resolve-investment-amount.util';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { SignalInput } from '../trade/interfaces/signal-input.interface';
import { TradeService } from '../trade/trade.service';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
import { InFlightSignalTracker } from './in-flight-signal-tracker.service';

/**
 * Orchestrates the documented condition pipeline (PROJECT_DOCUMENTATION.md
 * Section 9). Order must never change.
 *
 * Short selling (added 2026-07-16): one position per ticker, at most, never
 * hedged. Every signal resolves the ticker's current open position (if any)
 * BEFORE the daily throttle checks, then branches:
 *   - No position:            BUY opens a long, SELL opens a short — both are
 *                              NEW exposure, so both are subject to the daily
 *                              throttles below.
 *   - Position same direction: skipped (ALREADY_LONG / ALREADY_SHORT) — a
 *                              repeated same-direction signal must never
 *                              silently double exposure.
 *   - Position opposite direction: the signal CLOSES it — never throttled,
 *                              same reasoning as before short selling existed:
 *                              blocking a close over a daily cap would leave
 *                              unwanted exposure open, the unsafe outcome the
 *                              throttles exist to prevent in the first place.
 * `TradeService.executeTrade` decides open-vs-close from whether
 * `existingPosition` is null, not from `input.direction` — direction alone no
 * longer determines behaviour now that either direction can open or close.
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
    // Not one of the documented 11 pipeline steps — a technical safeguard
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

    // 5. resolve this ticker's current open position (either direction) —
    // moved ahead of the daily throttles because whether they apply now
    // depends on open-vs-close, not on input.direction alone.
    const positions = await this.igClientService.getOpenPositions();
    const existingPosition: IgPosition | null =
      positions.find((position) => position.epic === mapping.igEpic) ?? null;

    if (existingPosition) {
      if (input.direction === Direction.BUY && existingPosition.direction === Direction.BUY) {
        return this.tradeService.logSkip(input, TradeStatus.ALREADY_LONG, mapping.igEpic);
      }
      if (input.direction === Direction.SELL && existingPosition.direction === Direction.SELL) {
        return this.tradeService.logSkip(input, TradeStatus.ALREADY_SHORT, mapping.igEpic);
      }
    }

    // Opening NEW exposure = no position exists yet (BUY opens a long, SELL
    // opens a short). An opposite-direction position present means this
    // signal CLOSES it instead — never throttled below, same reasoning as
    // before short selling existed (blocking a close over a daily cap would
    // leave unwanted exposure open).
    const isOpening = existingPosition === null;

    if (isOpening) {
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
        const wouldBeInvested =
          investedToday + resolveInvestmentAmount(mapping, rules, input.investmentAmountOverride);
        if (wouldBeInvested > Number(rules.dailyMaxTotalInvestment)) {
          return this.tradeService.logSkip(input, TradeStatus.DAILY_TOTAL_LIMIT, mapping.igEpic);
        }
      }

      // 8. stock daily spend
      if (mapping.maxDailySpend !== null) {
        const investedTodayForStock = await this.tradeService.sumInvestmentSuccessToday(
          mapping.tvTicker,
        );
        const wouldBeInvested =
          investedTodayForStock +
          resolveInvestmentAmount(mapping, rules, input.investmentAmountOverride);
        if (wouldBeInvested > Number(mapping.maxDailySpend)) {
          return this.tradeService.logSkip(input, TradeStatus.STOCK_DAILY_LIMIT, mapping.igEpic);
        }
      }
    }

    // 9. calculate size, execute on IG, log SUCCESS/FAILED, handle failure counter
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
