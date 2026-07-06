import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../user/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { RefreshTokenService } from './refresh-token.service';
import { SessionService } from './session.service';

@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([RefreshToken, User])],
  providers: [SessionService, RefreshTokenService],
  exports: [SessionService, RefreshTokenService],
})
export class SessionModule {}
