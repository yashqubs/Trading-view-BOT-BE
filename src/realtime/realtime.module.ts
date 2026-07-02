import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { IgClientModule } from '../ig-client/ig-client.module';
import { User } from '../user/entities/user.entity';
import { RealtimeGateway } from './realtime.gateway';
import { WsAuthService } from './ws-auth.service';

@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([User]), AuthModule, IgClientModule],
  providers: [RealtimeGateway, WsAuthService],
})
export class RealtimeModule {}
