import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * @WebSocketGateway()'s own `cors` option is evaluated as a decorator
 * argument at module-load time, before Nest's DI container (and therefore
 * ConfigService/the loaded .env) exists — so it can't read FRONTEND_ORIGIN
 * directly. Overriding createIOServer() runs at actual server-bind time,
 * once the Nest application context (and ConfigService) is fully available,
 * which lets the socket server share main.ts's exact CORS policy.
 */
export class ConfiguredSocketIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const configService = this.app.get(ConfigService);
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: configService.get<string>('FRONTEND_ORIGIN'),
        credentials: true,
      },
    });
  }
}
