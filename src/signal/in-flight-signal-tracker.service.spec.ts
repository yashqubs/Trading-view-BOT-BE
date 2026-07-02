import { InFlightSignalTracker } from './in-flight-signal-tracker.service';

describe('InFlightSignalTracker', () => {
  it('resolves shutdown immediately when nothing is in flight', async () => {
    const tracker = new InFlightSignalTracker();
    await expect(tracker.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('waits for in-flight work to finish before resolving shutdown', async () => {
    const tracker = new InFlightSignalTracker();
    tracker.begin();

    let shutdownResolved = false;
    const shutdown = tracker.onApplicationShutdown().then(() => {
      shutdownResolved = true;
    });

    // Give the pending shutdown a tick to (not) resolve — it must still be waiting.
    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    tracker.end();
    await shutdown;
    expect(shutdownResolved).toBe(true);
  });

  it('resolves once all in-flight work finishes, not just the first', async () => {
    const tracker = new InFlightSignalTracker();
    tracker.begin();
    tracker.begin();

    const shutdown = tracker.onApplicationShutdown();

    tracker.end();
    tracker.end();
    await expect(shutdown).resolves.toBeUndefined();
  });
});
