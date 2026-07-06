import { randomBytes, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { REFRESH_TOKEN_TTL_MS } from './session.constants';

/**
 * Lives in SessionModule (not AuthModule) for the same reason SessionService
 * does — both AuthModule (login/refresh) and UserModule (the
 * pending-to-full-session upgrade on forced password change) need it, and
 * AuthModule already imports UserModule, so putting it in either would be
 * circular.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.refreshTokenRepository.insert({
      userId,
      tokenHash: this.hash(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    return token;
  }

  /**
   * Validates the token and, if it's still within its idle window, rotates
   * it: the old row is deleted and a brand new one issued with a fresh
   * expiry. Single-use by design — a captured-and-replayed old token can
   * never succeed, since rotation deletes it the moment it's used.
   */
  async rotate(token: string): Promise<{ userId: string; newToken: string } | null> {
    const row = await this.refreshTokenRepository.findOne({
      where: { tokenHash: this.hash(token) },
    });
    if (!row) {
      return null;
    }

    await this.refreshTokenRepository.delete({ id: row.id });
    if (row.expiresAt.getTime() < Date.now()) {
      return null;
    }

    const newToken = await this.issue(row.userId);
    return { userId: row.userId, newToken };
  }

  async revoke(token: string): Promise<void> {
    await this.refreshTokenRepository.delete({ tokenHash: this.hash(token) });
  }

  /** Called on every fresh login to enforce single-active-session — see AuthService.establishFullSession. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenRepository.delete({ userId });
  }

  async purgeExpired(): Promise<void> {
    await this.refreshTokenRepository.delete({ expiresAt: LessThan(new Date()) });
  }
}
