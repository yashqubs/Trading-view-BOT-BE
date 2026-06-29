import { Module } from '@nestjs/common';
import { SignalModule } from '../signal/signal.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [SignalModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
