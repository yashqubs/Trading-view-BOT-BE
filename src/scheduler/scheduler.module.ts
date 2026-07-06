import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../auth/session/session.module';
import { IgClientModule } from '../ig-client/ig-client.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AuthModule, SessionModule, IgClientModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
