import { randomBytes, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { SecretsService } from '../../secrets/secrets.service';
import { User } from '../../user/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { RefreshTokenService } from './refresh-token.service';
import {
  ACCESS_TOKEN_COOKIE_MAX_AGE_MS,
  ACCESS_TOKEN_EXPIRY,
  PENDING_SESSION_COOKIE_MAX_AGE_MS,
  PENDING_SESSION_EXPIRY,
  REFRESH_TOKEN_TTL_MS,
} from './session.constants';

/**
 * Issues/clears the `access_token` cookie. Lives outside AuthModule so both
 * AuthModule and UserModule can use it without a circular dependency
 * (AuthModule already imports UserModule for UserService).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly secretsService: SecretsService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Establishes a full (non-pending) session for a user who just completed
   * login, whichever path got them there (password-only, 2FA, or the
   * forced-password-change upgrade in UserController). Enforces
   * single-active-session per account: stamps a brand new session id on the
   * user row, which invalidates every other device's access token on its
   * very next request (see JwtStrategy.validate), and revokes every other
   * outstanding refresh token for this user so a stale device can't silently
   * renew its way back in either.
   */
  async establishFullSession(user: User, response: Response): Promise<void> {
    const sessionId = randomUUID();
    user.currentSessionId = sessionId;
    await this.userRepository.save(user);
    await this.refreshTokenService.revokeAllForUser(user.id);

    this.issueAccessTokenCookie(user, response, false, sessionId);
    const refreshToken = await this.refreshTokenService.issue(user.id);
    this.issueRefreshTokenCookie(response, refreshToken);
  }

  issueAccessTokenCookie(
    user: User,
    response: Response,
    pending: boolean,
    sessionId: string,
  ): void {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      pending,
      sessionId,
    };
    const token = this.jwtService.sign(payload, {
      secret: this.secretsService.get('JWT_SECRET'),
      expiresIn: pending ? PENDING_SESSION_EXPIRY : ACCESS_TOKEN_EXPIRY,
    });
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const maxAge = pending ? PENDING_SESSION_COOKIE_MAX_AGE_MS : ACCESS_TOKEN_COOKIE_MAX_AGE_MS;

    response.cookie('access_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge,
    });

    // Deliberately NOT httpOnly — the frontend reads this cookie's value and
    // echoes it back as the X-CSRF-Token header (see CsrfGuard). It carries
    // no authority on its own, only a random value to double-submit.
    response.cookie('csrf_token', randomBytes(32).toString('hex'), {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'strict',
      maxAge,
    });
  }

  /**
   * Not issued for pending sessions — the forced-password-change flow is
   * meant to be completed promptly, not silently kept alive for an hour.
   */
  issueRefreshTokenCookie(response: Response, rawRefreshToken: string): void {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    response.cookie('refresh_token', rawRefreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }

  clearCookie(response: Response): void {
    response.clearCookie('access_token');
    response.clearCookie('csrf_token');
    response.clearCookie('refresh_token');
  }
}
