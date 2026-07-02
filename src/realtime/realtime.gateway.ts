import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { IgClientService } from '../ig-client/ig-client.service';
import { IgPosition } from '../ig-client/ig-client.types';
import { TradeLog } from '../trade/entities/trade-log.entity';
import { TradingRules } from '../trading-rules/entities/trading-rules.entity';
import { WsAuthService } from './ws-auth.service';

/**
 * Pushes domain events (trade executed, rules changed, IG session status,
 * open positions) to every connected, authenticated portal client — replaces
 * the frontend's old fixed-interval polling entirely. Business services never
 * talk to this gateway directly; they emit plain domain events (via
 * EventEmitter2 — see trade.service.ts, trading-rules.service.ts,
 * ig-client.service.ts) and this class is the only thing that knows sockets
 * exist, listening for those same events and relaying them.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly wsAuthService: WsAuthService,
    private readonly igClientService: IgClientService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const user = await this.wsAuthService.authenticate(socket);
    if (!user) {
      socket.disconnect(true);
      return;
    }
    socket.data.user = user;

    // Catch this one newly-connected client up with the current picture —
    // every other client already has it from the last broadcast.
    try {
      const positions = await this.igClientService.getOpenPositions();
      socket.emit('positions:updated', positions);
    } catch (error) {
      this.logger.warn(`Could not send initial positions snapshot: ${(error as Error).message}`);
    }
  }

  @OnEvent('trade.created')
  handleTradeCreated(trade: TradeLog): void {
    this.safeBroadcast('trade:created', trade);
  }

  @OnEvent('rules.updated')
  handleRulesUpdated(rules: TradingRules): void {
    this.safeBroadcast('rules:updated', rules);
  }

  // Internal event name (`ig.session.changed`, emitted by IgClientService)
  // deliberately differs from the external socket event name (`system:status`,
  // what the frontend listens for) — IgClientService only knows its own
  // session state changed, not that a frontend "system status" concept exists.
  @OnEvent('ig.session.changed')
  handleIgSessionChanged(payload: { igConnected: boolean }): void {
    this.safeBroadcast('system:status', payload);
  }

  @OnEvent('positions.updated')
  handlePositionsUpdated(positions: IgPosition[]): void {
    this.safeBroadcast('positions:updated', positions);
  }

  // A broadcast is a side effect of something that already happened and was
  // already durably saved — it must never throw back into the caller that
  // emitted the domain event (trade execution, rules update, etc.).
  private safeBroadcast(event: string, payload: unknown): void {
    try {
      this.server.emit(event, payload);
    } catch (error) {
      this.logger.warn(`Failed to broadcast ${event}: ${(error as Error).message}`);
    }
  }
}
