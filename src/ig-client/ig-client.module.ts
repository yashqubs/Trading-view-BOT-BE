import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IgClientService } from './ig-client.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>('IG_BASE_URL'),
        timeout: 10_000,
      }),
    }),
  ],
  providers: [IgClientService],
  exports: [IgClientService],
})
export class IgClientModule {}
