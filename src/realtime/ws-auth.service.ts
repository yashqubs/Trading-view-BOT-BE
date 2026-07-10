import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { parse as parseCookie } from 'cookie';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { SecretsService } from '../secrets/secrets.service';
import { User } from '../user/entities/user.entity';

/**
 * Authenticates a WebSocket handshake using the same `access_token` httpOnly
 * cookie REST auth already relies on — no separate login flow for sockets.
 * Mirrors `jwt.strategy.ts`'s validate() (cookie -> verify -> blacklist check
 * -> active-user check); keep both in sync if the REST auth rules change.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly secretsService: SecretsService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async authenticate(socket: Socket): Promise<AuthenticatedUser | null> {
    const rawCookieHeader = socket.handshake.headers.cookie;
    if (!rawCookieHeader) {
      return null;
    }

    const token = parseCookie(rawCookieHeader).access_token;
    if (!token) {
      return null;
    }

    if (await this.tokenBlacklistService.isBlacklisted(token)) {
      return null;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.secretsService.get('JWT_SECRET'),
      });
    } catch (error) {
      this.logger.debug(`WS handshake rejected: invalid token (${(error as Error).message})`);
      return null;
    }

    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) {
      return null;
    }

    return { id: user.id, email: user.email, pending: payload.pending };
  }
}
