import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { SecretsService } from '../../secrets/secrets.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { User } from '../../user/entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { TokenBlacklistService } from '../token-blacklist.service';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly secretsService: SecretsService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKeyProvider: (
        _request: Request,
        _rawJwtToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        try {
          done(null, secretsService.get('JWT_SECRET'));
        } catch (error) {
          done(error as Error);
        }
      },
    });
  }

  async validate(request: Request, payload: JwtPayload): Promise<AuthenticatedUser> {
    const rawToken = cookieExtractor(request);
    if (rawToken && (await this.tokenBlacklistService.isBlacklisted(rawToken))) {
      throw new UnauthorizedException('Session has been revoked');
    }

    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Account is not active');
    }

    // Single-active-session enforcement: a later login on another device
    // overwrites currentSessionId (see AuthService.establishFullSession),
    // which immediately invalidates this token even though it hasn't expired
    // yet. Skipped for pending (forced-password-change) sessions — those
    // aren't full logins and don't carry a real session id.
    if (!payload.pending && payload.sessionId !== user.currentSessionId) {
      throw new UnauthorizedException('Logged in from another device');
    }

    return { id: user.id, email: user.email, pending: payload.pending };
  }
}
