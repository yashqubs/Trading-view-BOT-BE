import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

const SHUTDOWN_DRAIN_TIMEOUT_MS = 15_000;

/**
 * The webhook endpoint responds to TradingView within 3 seconds and
 * processes each signal asynchronously, fire-and-forget (see
 * WebhookController — required by TradingView's own timeout). Without this,
 * a deploy restart (PM2 sends SIGTERM) could kill the process mid-trade: an
 * IG order placed but not yet confirmed or logged, leaving a real open
 * position with no trade_log row and no record it ever happened. Combined
 * with main.ts's `app.enableShutdownHooks()`, this delays actual process
 * exit until every in-flight signal finishes, or a bounded timeout elapses
 * so a genuinely stuck call can't block deploys forever.
 */
@Injectable()
export class InFlightSignalTracker implements OnApplicationShutdown {
  private readonly logger = new Logger(InFlightSignalTracker.name);
  private count = 0;
  private resolveDrained: (() => void) | null = null;

  begin(): void {
    this.count += 1;
  }

  end(): void {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) {
      this.resolveDrained?.();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.count === 0) return;
    this.logger.log(`Waiting for ${this.count} in-flight signal(s) to finish before shutdown`);

    const drained = new Promise<void>((resolve) => {
      this.resolveDrained = resolve;
    });
    // Whichever branch of the race resolves first, clear the other's timer —
    // an uncleared setTimeout keeps the event loop (and in tests, the jest
    // worker) alive for the rest of its delay even after the race settles.
    let timeoutHandle: NodeJS.Timeout;
    const timeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
    });
    await Promise.race([drained, timeout]).finally(() => clearTimeout(timeoutHandle));

    if (this.count > 0) {
      this.logger.warn(`Shutdown timeout reached with ${this.count} signal(s) still in flight`);
    }
  }
}
