import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateTradingRulesDto } from './dto/update-trading-rules.dto';
import { TradingRules } from './entities/trading-rules.entity';

const SINGLETON_ID = 1;

@Injectable()
export class TradingRulesService {
  constructor(
    @InjectRepository(TradingRules)
    private readonly tradingRulesRepository: Repository<TradingRules>,
  ) {}

  async get(): Promise<TradingRules> {
    const existing = await this.tradingRulesRepository.findOne({ where: { id: SINGLETON_ID } });
    if (existing) {
      return existing;
    }
    return this.tradingRulesRepository.save(
      this.tradingRulesRepository.create({ id: SINGLETON_ID }),
    );
  }

  async update(dto: UpdateTradingRulesDto, updatedBy: string): Promise<TradingRules> {
    const rules = await this.get();

    if (dto.botEnabled !== undefined) {
      rules.botEnabled = dto.botEnabled;
      rules.autoPaused = false; // explicit admin action always supersedes the auto-pause state
    }
    if (dto.allowBuy !== undefined) rules.allowBuy = dto.allowBuy;
    if (dto.allowSell !== undefined) rules.allowSell = dto.allowSell;
    if (dto.dailyMaxTotalInvestment !== undefined) {
      rules.dailyMaxTotalInvestment = dto.dailyMaxTotalInvestment.toFixed(2);
    }
    if (dto.dailyMaxTradeCount !== undefined) rules.dailyMaxTradeCount = dto.dailyMaxTradeCount;
    if (dto.maxOpenPositionsGlobal !== undefined) {
      rules.maxOpenPositionsGlobal = dto.maxOpenPositionsGlobal;
    }
    if (dto.maxConsecutiveFailures !== undefined) {
      rules.maxConsecutiveFailures = dto.maxConsecutiveFailures;
    }
    if (dto.tradeStartTimeUtc !== undefined) rules.tradeStartTimeUtc = dto.tradeStartTimeUtc;
    if (dto.tradeEndTimeUtc !== undefined) rules.tradeEndTimeUtc = dto.tradeEndTimeUtc;
    if (dto.tradeWeekdaysOnly !== undefined) rules.tradeWeekdaysOnly = dto.tradeWeekdaysOnly;

    rules.updatedBy = updatedBy;
    return this.tradingRulesRepository.save(rules);
  }

  /** Called by TradeModule after a FAILED trade. Returns true if the auto-pause threshold was hit. */
  async recordFailure(): Promise<boolean> {
    const rules = await this.get();
    rules.consecutiveFailureCount += 1;

    const shouldAutoPause = rules.consecutiveFailureCount >= rules.maxConsecutiveFailures;
    if (shouldAutoPause) {
      rules.botEnabled = false;
      rules.autoPaused = true;
    }

    await this.tradingRulesRepository.save(rules);
    return shouldAutoPause;
  }

  /** Called by TradeModule after a SUCCESS trade. */
  async resetFailureCount(): Promise<void> {
    const rules = await this.get();
    if (rules.consecutiveFailureCount !== 0) {
      rules.consecutiveFailureCount = 0;
      await this.tradingRulesRepository.save(rules);
    }
  }
}
