import { Module } from '@nestjs/common';
import { IgClientModule } from '../ig-client/ig-client.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [IgClientModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
