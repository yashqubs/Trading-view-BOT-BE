import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionService } from './session.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
