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

    response.cookie('access_token', token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: pending ? PENDING_SESSION_COOKIE_MAX_AGE_MS : SESSION_COOKIE_MAX_AGE_MS,
    });
  }

  clearCookie(response: Response): void {
    response.clearCookie('access_token');
  }
}
