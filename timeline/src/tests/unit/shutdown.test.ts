/**
 * Unit tests for the shutdown sequence (`shutdownApplication` in src/index.ts).
 *
 * The ordering is the whole point of this file:
 *   - the force-exit timer must be armed BEFORE anything that can hang, or a
 *     hung `close()`/cleanup leaves the process with no way out at all;
 *   - the stream handler must be detached before it is closed, or a late upgrade
 *     still reaches a handler that is being torn down;
 *   - live sockets must be terminated before `server.close()`, because an open
 *     WebSocket keeps `close()` from completing.
 *
 * Every test drives the sequence through the exported function that
 * `Application.shutdown` calls, with a fake server, a fake handler and a fake
 * `exit`, so no listener, database or process exit is involved.
 */

import { describe, it, expect } from 'vitest';
import { shutdownApplication, SHUTDOWN_FORCE_EXIT_MS } from '@/index';
import type { ShutdownServer } from '@/index';

/** An `http.Server` stand-in whose close callback is run explicitly. */
class FakeServer implements ShutdownServer {
  readonly closeCallbacks: Array<() => void> = [];
  readonly calls: string[] = [];

  close(callback: () => void): ShutdownServer {
    this.calls.push('close');
    this.closeCallbacks.push(callback);
    return this;
  }

  closeIdleConnections(): void {
    this.calls.push('closeIdleConnections');
  }

  /** Run the callback `close()` invokes once every connection is gone. */
  finishClose(): void {
    for (const callback of this.closeCallbacks.splice(0)) {
      callback();
    }
  }
}

/** A stream handler stand-in; records the order of its calls. */
function fakeHandler(order: string[], closeImplementation?: () => Promise<void>): {
  detach: () => void;
  close: () => Promise<void>;
} {
  return {
    detach: () => {
      order.push('detach');
    },
    close: async () => {
      order.push('handler.close');
      if (closeImplementation) {
        await closeImplementation();
      }
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('shutdownApplication', () => {
  it('detaches the handler and closes it before closing the server, then exits 0', async () => {
    const order: string[] = [];
    const server = new FakeServer();
    const exits: number[] = [];

    await shutdownApplication({
      server,
      streamHandler: fakeHandler(order),
      cleanup: async () => {
        order.push('cleanup');
      },
      exit: (code) => {
        order.push(`exit:${code}`);
        exits.push(code);
      },
      forceExitMs: 5000,
    });

    // Detach came first: a late upgrade must not reach a handler whose sessions
    // are being torn down.
    expect(order).toEqual(['detach', 'handler.close']);
    expect(server.calls).toEqual(['close', 'closeIdleConnections']);
    // Cleanup runs only once the server reports that its connections are gone.
    expect(exits).toEqual([]);

    server.finishClose();
    await flush();

    expect(order).toEqual(['detach', 'handler.close', 'cleanup', 'exit:0']);
    expect(exits).toEqual([0]);
  });

  it('arms the force-exit timer before awaiting close(), so a hung close still exits', async () => {
    const server = new FakeServer();
    const exits: number[] = [];

    // `close()` never settles. This is the case the force-exit timer exists for,
    // and the case where arming the timer after the await would arm nothing.
    // Deliberately not awaited: the sequence must never resolve on its own.
    void shutdownApplication({
      server,
      streamHandler: fakeHandler([], () => new Promise<void>(() => undefined)),
      cleanup: async () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      forceExitMs: 30,
    });

    expect(exits).toEqual([]);
    await sleep(150);
    expect(exits).toEqual([1]);
  });

  it('does not force an exit after a clean shutdown', async () => {
    const exits: number[] = [];
    const server = new FakeServer();

    await shutdownApplication({
      server,
      streamHandler: fakeHandler([]),
      cleanup: async () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      forceExitMs: 30,
    });
    server.finishClose();
    await flush();
    expect(exits).toEqual([0]);

    // The timer armed at the start must be cleared, or a clean shutdown would
    // still be followed by a forced exit 1.
    await sleep(150);
    expect(exits).toEqual([0]);
  });

  it('exits 1 when cleanup fails', async () => {
    const exits: number[] = [];
    const server = new FakeServer();

    await shutdownApplication({
      server,
      streamHandler: fakeHandler([]),
      cleanup: async () => {
        throw new Error('cleanup exploded');
      },
      exit: (code) => {
        exits.push(code);
      },
      forceExitMs: 5000,
    });
    server.finishClose();
    await flush();

    expect(exits).toEqual([1]);
  });

  it('still closes the server when the stream handler refuses to close', async () => {
    const order: string[] = [];
    const server = new FakeServer();
    const exits: number[] = [];

    await shutdownApplication({
      server,
      streamHandler: fakeHandler(order, async () => {
        throw new Error('handler close failed');
      }),
      cleanup: async () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      forceExitMs: 5000,
    });

    // The detach happened and the server close was still attempted.
    expect(order).toEqual(['detach', 'handler.close']);
    expect(server.calls).toEqual(['close', 'closeIdleConnections']);

    server.finishClose();
    await flush();
    expect(exits).toEqual([0]);
  });

  it('shuts down without a stream handler at all', async () => {
    const server = new FakeServer();
    const exits: number[] = [];

    await shutdownApplication({
      server,
      cleanup: async () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      forceExitMs: 5000,
    });
    server.finishClose();
    await flush();

    expect(exits).toEqual([0]);
  });

  it('uses a 30 second force-exit window by default', () => {
    expect(SHUTDOWN_FORCE_EXIT_MS).toBe(30 * 1000);
  });
});
