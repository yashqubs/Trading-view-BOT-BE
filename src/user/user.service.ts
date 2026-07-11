import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const BCRYPT_COST = 12;

export interface CreatedUserResult {
  user: User;
  tempPassword: string;
}

export interface ResetPasswordResult {
  user: User;
  tempPassword: string;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  findAll(): Promise<User[]> {
    return this.userRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<CreatedUserResult> {
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    const tempPassword = this.generateTempPassword();
    const user = this.userRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(tempPassword, BCRYPT_COST),
      tempPassword,
      mustChangePassword: true,
      twoFactorEnabled: false,
      active: true,
    });

    const saved = await this.userRepository.save(user);
    await this.emailService.sendInviteEmail(
      saved.email,
      saved.name,
      tempPassword,
      this.portalUrl(),
    );
    return { user: saved, tempPassword };
  }

  async update(id: string, dto: UpdateUserDto, currentUserId: string): Promise<User> {
    const user = await this.findByIdOrThrow(id);

    if (dto.active === false && id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    if (dto.active === false) {
      await this.assertAnotherActiveUserExists(id);
    }

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.active !== undefined) user.active = dto.active;

    return this.userRepository.save(user);
  }

  /**
   * The single "get them a working temp password" action for an admin.
   * If one is already pending — the user hasn't set their own password yet
   * — this resends that exact same password instead of minting a new one,
   * so clicking it again (or an email that never arrived) doesn't keep
   * invalidating whatever was already sent or shown on screen. Only issues
   * a genuinely new one when there's nothing pending to resend, i.e. the
   * user already has their own password and needs a real reset.
   */
  async resetPassword(id: string): Promise<ResetPasswordResult> {
    const user = await this.findByIdOrThrow(id);

    if (user.mustChangePassword && user.tempPassword) {
      await this.emailService.sendPasswordResetEmail(
        user.email,
        user.name,
        user.tempPassword,
        this.portalUrl(),
      );
      return { user, tempPassword: user.tempPassword };
    }

    return this.issueNewTempPassword(user);
  }

  private async issueNewTempPassword(user: User): Promise<ResetPasswordResult> {
    const tempPassword = this.generateTempPassword();

    user.passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);
    user.tempPassword = tempPassword;
    user.mustChangePassword = true;
    const saved = await this.userRepository.save(user);

    await this.emailService.sendPasswordResetEmail(
      saved.email,
      saved.name,
      tempPassword,
      this.portalUrl(),
    );
    return { user: saved, tempPassword };
  }

  async deactivate(id: string, currentUserId: string): Promise<User> {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.findByIdOrThrow(id);
    await this.assertAnotherActiveUserExists(id);
    user.active = false;
    return this.userRepository.save(user);
  }

  async changeOwnPassword(userId: string, dto: ChangePasswordDto): Promise<User> {
    const user = await this.findByIdOrThrow(userId);
    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    user.mustChangePassword = false;
    user.tempPassword = null;
    return this.userRepository.save(user);
  }

  private async assertAnotherActiveUserExists(excludingUserId: string): Promise<void> {
    const activeUserCount = await this.userRepository.count({ where: { active: true } });
    const excludedUser = await this.userRepository.findOne({ where: { id: excludingUserId } });
    const remaining = excludedUser?.active ? activeUserCount - 1 : activeUserCount;

    if (remaining < 1) {
      throw new BadRequestException('At least one active user must always exist');
    }
  }

  private generateTempPassword(): string {
    return randomBytes(9).toString('base64url');
  }

  private portalUrl(): string {
    return this.configService.get<string>('FRONTEND_ORIGIN') ?? '';
  }
}
