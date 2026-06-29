import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { authenticator } from '@otplib/v12-adapter';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { SecretsService } from '../secrets/secrets.service';
import { Login2faDto } from './dto/login-2fa.dto';
import { LoginDto } from './dto/login.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { User } from '../user/entities/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { TokenBlacklistService } from './token-blacklist.service';
import { decrypt, encrypt } from './utils/encryption.util';
import { generateRecoveryCodes } from './utils/recovery-codes.util';

const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_EXPIRY = '1h';
const SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
const PENDING_SESSION_EXPIRY = '15m';
const PENDING_SESSION_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

export interface LoginChallengeResult {
  requiresSetup2fa: boolean;
  requires2fa: boolean;
}

export interface Setup2faResult {
  qrCodeUri: string;
  recoveryCodes: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly secretsService: SecretsService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly configService: ConfigService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_COST);
  }

  /**
   * Validates credentials and issues a restricted "pending" session cookie
   * immediately — scoped (see JwtAuthGuard + @AllowPendingSession) to only
   * GET /auth/me, the 2FA setup/verify endpoints, PATCH /users/me/password,
   * and logout, until 2FA is confirmed. Knowing the password alone never
   * grants access to anything else.
   */
  async login(dto: LoginDto, response: Response): Promise<LoginChallengeResult> {
    const user = await this.validateCredentials(dto.email, dto.password);
    this.issueCookie(user, response, true);

    return {
      requiresSetup2fa: !user.totpEnabled,
      requires2fa: user.totpEnabled,
    };
  }

  async setup2fa(userId: string): Promise<Setup2faResult> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    if (user.totpEnabled) {
      throw new BadRequestException('2FA is already enabled for this account');
    }

    const encryptionKey = this.secretsService.get('TOTP_ENCRYPTION_KEY');
    const secret = authenticator.generateSecret();
    const recoveryCodes = generateRecoveryCodes();

    user.totpSecret = encrypt(secret, encryptionKey);
    user.recoveryCodes = encrypt(JSON.stringify(recoveryCodes), encryptionKey);
    await this.userRepository.save(user);

    const qrCodeUri = await QRCode.toDataURL(
      authenticator.keyuri(user.email, 'TradingBot', secret),
    );

    return { qrCodeUri, recoveryCodes };
  }

  async verify2faSetup(userId: string, dto: Verify2faDto, response: Response): Promise<User> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    if (!user.totpSecret) {
      throw new BadRequestException('2FA setup has not been started for this account');
    }

    const isValid = await this.verifyAndConsumeCode(user, dto.code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    user.totpEnabled = true;
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    this.issueCookie(user, response, false);
    return user;
  }

  async loginWith2fa(dto: Login2faDto, response: Response): Promise<User> {
    const user = await this.validateCredentials(dto.email, dto.password);
    if (!user.totpEnabled) {
      throw new BadRequestException('2FA is not set up for this account');
    }

    const isValid = await this.verifyAndConsumeCode(user, dto.code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    this.issueCookie(user, response, false);
    return user;
  }

  async logout(token: string | undefined, response: Response): Promise<void> {
    if (token) {
      try {
        const payload = this.jwtService.decode(token) as (JwtPayload & { exp: number }) | null;
        const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : new Date();
        await this.tokenBlacklistService.blacklist(token, expiresAt);
      } catch (error) {
        this.logger.warn('Failed to blacklist token on logout', (error as Error).message);
      }
    }
    response.clearCookie('access_token');
  }

  private issueCookie(user: User, response: Response, pending: boolean): void {
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

  private async verifyAndConsumeCode(user: User, code: string): Promise<boolean> {
    const encryptionKey = this.secretsService.get('TOTP_ENCRYPTION_KEY');
    const secret = decrypt(user.totpSecret as string, encryptionKey);

    if (authenticator.check(code, secret)) {
      return true;
    }

    if (!user.recoveryCodes) {
      return false;
    }

    const recoveryCodes: string[] = JSON.parse(decrypt(user.recoveryCodes, encryptionKey));
    const matchIndex = recoveryCodes.indexOf(code.toUpperCase());
    if (matchIndex === -1) {
      return false;
    }

    recoveryCodes.splice(matchIndex, 1);
    user.recoveryCodes = encrypt(JSON.stringify(recoveryCodes), encryptionKey);
    await this.userRepository.save(user);
    return true;
  }

  private async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { email } });
    const genericError = new UnauthorizedException('Invalid email or password');

    if (!user || !user.active) {
      throw genericError;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Account is temporarily locked. Try again later.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        user.failedLoginAttempts = 0;
      }
      await this.userRepository.save(user);
      throw genericError;
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await this.userRepository.save(user);
    }

    return user;
  }
}
