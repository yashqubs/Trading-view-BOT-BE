import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { Login2faDto } from './dto/login-2fa.dto';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { User } from '../user/entities/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { SessionService } from './session/session.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { generateOtp, hashOtp, maskEmail } from './utils/otp.util';

const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export interface LoginChallengeResult {
  requiresPasswordChange: boolean;
  requires2fa: boolean;
  message?: string;
  user?: User;
}

export interface OtpSentResult {
  message: string;
  maskedEmail: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_COST);
  }

  /**
   * Orchestrates the three possible outcomes of a credentials check:
   * forced password change (pending cookie, nothing else revealed yet),
   * email-OTP challenge (no cookie until the code is verified), or a
   * full session immediately.
   */
  async login(dto: LoginDto, response: Response): Promise<LoginChallengeResult> {
    const user = await this.validateCredentials(dto.email, dto.password);

    if (user.mustChangePassword) {
      this.sessionService.issueCookie(user, response, true);
      return { requiresPasswordChange: true, requires2fa: false };
    }

    if (user.twoFactorEnabled) {
      await this.issueOtp(user, 'LOGIN');
      return {
        requiresPasswordChange: false,
        requires2fa: true,
        message: `Code sent to ${maskEmail(user.email)}`,
      };
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);
    this.sessionService.issueCookie(user, response, false);
    return { requiresPasswordChange: false, requires2fa: false, user };
  }

  async loginWith2fa(dto: Login2faDto, response: Response): Promise<User> {
    const user = await this.validateCredentials(dto.email, dto.password);
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled for this account');
    }

    await this.verifyOtp(user, dto.code, 'LOGIN');

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);
    this.sessionService.issueCookie(user, response, false);
    return user;
  }

  async resendLoginOtp(dto: ResendOtpDto): Promise<OtpSentResult> {
    const user = await this.validateCredentials(dto.email, dto.password);
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled for this account');
    }
    return this.issueOtp(user, 'LOGIN');
  }

  async setup2fa(userId: string): Promise<OtpSentResult> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        'Two-factor authentication is already enabled for this account',
      );
    }
    return this.issueOtp(user, 'SETUP');
  }

  async resendSetupOtp(userId: string): Promise<OtpSentResult> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    return this.issueOtp(user, 'SETUP');
  }

  async verify2faSetup(userId: string, dto: Verify2faDto): Promise<User> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    await this.verifyOtp(user, dto.code, 'SETUP');

    user.twoFactorEnabled = true;
    await this.userRepository.save(user);
    return user;
  }

  async skip2fa(userId: string): Promise<User> {
    return this.userRepository.findOneByOrFail({ id: userId });
  }

  async disable2fa(userId: string, dto: Disable2faDto): Promise<User> {
    const user = await this.userRepository.findOneByOrFail({ id: userId });
    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Incorrect password');
    }

    user.twoFactorEnabled = false;
    this.clearOtp(user);
    await this.userRepository.save(user);
    return user;
  }

  async logout(token: string | undefined, response: Response): Promise<void> {
    if (token) {
      try {
        const payload = this.jwtService.decode(token) as (JwtPayload & { exp: number }) | null;
        const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : new Date();
        await this.tokenBlacklistService.blacklist(token, expiresAt);
      } catch {
        // best-effort — an undecodable token can't be replayed anyway
      }
    }
    this.sessionService.clearCookie(response);
  }

  private async issueOtp(user: User, purpose: 'LOGIN' | 'SETUP'): Promise<OtpSentResult> {
    if (user.otpLastSentAt && Date.now() - user.otpLastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new BadRequestException('Please wait before requesting another code');
    }

    const code = generateOtp();
    user.otpCodeHash = hashOtp(code);
    user.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    user.otpPurpose = purpose;
    user.otpAttempts = 0;
    user.otpLastSentAt = new Date();
    await this.userRepository.save(user);

    await this.emailService.sendOtpEmail(user.email, code, purpose);

    return {
      message: `Code sent to ${maskEmail(user.email)}`,
      maskedEmail: maskEmail(user.email),
    };
  }

  private async verifyOtp(user: User, code: string, purpose: 'LOGIN' | 'SETUP'): Promise<void> {
    const invalid = new UnauthorizedException('Invalid or expired code');

    if (
      !user.otpCodeHash ||
      user.otpPurpose !== purpose ||
      !user.otpExpiresAt ||
      user.otpExpiresAt.getTime() < Date.now()
    ) {
      throw invalid;
    }

    if (user.otpCodeHash !== hashOtp(code)) {
      user.otpAttempts += 1;
      if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
        this.clearOtp(user);
      }
      await this.userRepository.save(user);
      throw invalid;
    }

    this.clearOtp(user);
    await this.userRepository.save(user);
  }

  private clearOtp(user: User): void {
    user.otpCodeHash = null;
    user.otpExpiresAt = null;
    user.otpPurpose = null;
    user.otpAttempts = 0;
    user.otpLastSentAt = null;
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
