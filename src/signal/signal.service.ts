import { Injectable, Logger } from '@nestjs/common';
import { Direction, TradeStatus } from '../common/enums';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgPosition } from '../ig-client/ig-client.types';
import { MappingService } from '../mapping/mapping.service';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { SignalInput } from '../trade/interfaces/signal-input.interface';
import { TradeService } from '../trade/trade.service';
import { TradingRulesService } from '../trading-rules/trading-rules.service';
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
@Injectable()
export class SignalService {
  private readonly logger = new Logger(SignalService.name);

  constructor(
    private readonly tradingRulesService: TradingRulesService,
    private readonly mappingService: MappingService,
    private readonly tradeService: TradeService,
    private readonly igClientService: IgClientService,
  ) {}

  async processSignal(input: SignalInput): Promise<TradeLog> {
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

    // 5. market open
    if (!isMarketOpen(rules, input.signalReceivedAt)) {
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

      // 8. global open positions
      if (rules.maxOpenPositionsGlobal !== null) {
        const globalPositionCount = await this.igClientService.getOpenPositionCount();
        if (globalPositionCount >= rules.maxOpenPositionsGlobal) {
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
      const stockPositionCount = await this.igClientService.getOpenPositionCount(mapping.igEpic);
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
    return this.tradeService.executeTrade(input, mapping, existingPosition);
  }
}
