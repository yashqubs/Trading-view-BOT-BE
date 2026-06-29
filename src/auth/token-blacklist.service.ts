import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TokenBlacklist } from './entities/token-blacklist.entity';

@Injectable()
export class TokenBlacklistService {
  constructor(
    @InjectRepository(TokenBlacklist)
    private readonly tokenBlacklistRepository: Repository<TokenBlacklist>,
  ) {}

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async blacklist(token: string, expiresAt: Date): Promise<void> {
    await this.tokenBlacklistRepository.insert({
      tokenHash: this.hash(token),
      expiresAt,
    });
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const count = await this.tokenBlacklistRepository.count({
      where: { tokenHash: this.hash(token) },
    });
    return count > 0;
  }

  async purgeExpired(): Promise<void> {
    await this.tokenBlacklistRepository.delete({ expiresAt: LessThan(new Date()) });
  }
}
