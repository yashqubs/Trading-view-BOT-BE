import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IgClientModule } from '../ig-client/ig-client.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AuthModule, IgClientModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
