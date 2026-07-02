import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { SecretsService } from '../../secrets/secrets.service';
import { User } from '../../user/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

const SESSION_EXPIRY = '1h';
const SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
const PENDING_SESSION_EXPIRY = '15m';
const PENDING_SESSION_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

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
  ) {}

  issueCookie(user: User, response: Response, pending: boolean): void {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role, pending };
    const token = this.jwtService.sign(payload, {
      secret: this.secretsService.get('JWT_SECRET'),
      expiresIn: pending ? PENDING_SESSION_EXPIRY : SESSION_EXPIRY,
    });
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const maxAge = pending ? PENDING_SESSION_COOKIE_MAX_AGE_MS : SESSION_COOKIE_MAX_AGE_MS;

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

  clearCookie(response: Response): void {
    response.clearCookie('access_token');
    response.clearCookie('csrf_token');
  }
}
