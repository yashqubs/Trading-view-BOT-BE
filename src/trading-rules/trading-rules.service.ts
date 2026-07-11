import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateTradingRulesDto } from './dto/update-trading-rules.dto';
import { TradingRules } from './entities/trading-rules.entity';

const SINGLETON_ID = 1;

@Injectable()
export class TradingRulesService {
  private readonly logger = new Logger(TradingRulesService.name);

  constructor(
    @InjectRepository(TradingRules)
    private readonly tradingRulesRepository: Repository<TradingRules>,
    private readonly eventEmitter: EventEmitter2,
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
      rules.dailyMaxTotalInvestment = dto.dailyMaxTotalInvestment;
    }
    if (dto.dailyMaxTradeCount !== undefined) rules.dailyMaxTradeCount = dto.dailyMaxTradeCount;
    if (dto.maxConsecutiveFailures !== undefined) {
      rules.maxConsecutiveFailures = dto.maxConsecutiveFailures;
    }
    if (dto.executionMode !== undefined) rules.executionMode = dto.executionMode;
    if (dto.maxSlippagePercent !== undefined) rules.maxSlippagePercent = dto.maxSlippagePercent;

    rules.updatedBy = updatedBy;
    const saved = await this.tradingRulesRepository.save(rules);
    this.emitRulesUpdated(saved);
    return saved;
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

    const saved = await this.tradingRulesRepository.save(rules);
    this.emitRulesUpdated(saved);
    return shouldAutoPause;
  }

  /** Called by TradeModule after a SUCCESS trade. */
  async resetFailureCount(): Promise<void> {
    const rules = await this.get();
    if (rules.consecutiveFailureCount !== 0) {
      rules.consecutiveFailureCount = 0;
      const saved = await this.tradingRulesRepository.save(rules);
      this.emitRulesUpdated(saved);
    }
  }

  // See trade.service.ts's emitTradeCreated for why this swallows errors
  // rather than propagating — a broadcast must never break rules persistence.
  private emitRulesUpdated(rules: TradingRules): void {
    try {
      this.eventEmitter.emit('rules.updated', rules);
    } catch (error) {
      this.logger.warn(`Failed to emit rules.updated: ${(error as Error).message}`);
    }
  }
}
