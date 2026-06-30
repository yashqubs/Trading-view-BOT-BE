import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, default: UserRole.VIEWER })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'boolean', default: false, name: 'two_factor_enabled' })
  twoFactorEnabled: boolean;

  @Exclude()
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'otp_code_hash' })
  otpCodeHash: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'otp_expires_at' })
  otpExpiresAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true, name: 'otp_purpose' })
  otpPurpose: 'LOGIN' | 'SETUP' | null;

  @Column({ type: 'int', default: 0, name: 'otp_attempts' })
  otpAttempts: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'otp_last_sent_at' })
  otpLastSentAt: Date | null;

  @Column({ type: 'boolean', default: true, name: 'must_change_password' })
  mustChangePassword: boolean;

  @Column({ type: 'int', default: 0, name: 'failed_login_attempts' })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_until' })
  lockedUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_login_at' })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
