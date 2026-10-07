/**
 * The REAL startup/shutdown path for the WebSocket stream (src/index.ts).
 *
 * The other stream suite builds its own `http.Server` and drives
 * `StreamHandler.close()` directly. That test passes even if
 * `Application.start()` never attached the handler or `shutdown()` never closed
 * it, so this suite boots the real `Application` instead:
 *
 *   - `Application.initialize()` builds the container and the routes;
 *   - `Application.start()` creates the HTTP server and lets the stream handler
 *     attach its `upgrade` listener to it;
 *   - a real `ws` client opens a stream through that listener and gets its
 *     `auth_result`, which proves the attachment happened;
 *   - SIGTERM runs the real shutdown sequence, which must terminate the live
 *     socket (or `server.close()` would never complete) and exit 0.
 *
 * `process.exit` is replaced through `Application`'s injectable exit so the
 * assertions can observe the exit code without ending the test run; the timer,
 * detach and close ordering is pinned separately in src/tests/unit/shutdown.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { Application } from '@/index';
import { getContainer } from '@/container';
import {
  getStreamTokenStore,
  resetStreamTokenStore,
  isRecord,
  STREAM_PATH,
} from '@/websocket';

function rawToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

function readJsonObject(data: RawData): Record<string, unknown> {
  const parsed: unknown = JSON.parse(rawToString(data));
  if (!isRecord(parsed)) {
    throw new Error('expected a JSON object frame');
  }
  return parsed;
}

/** Ask the OS for a free port, then release it for `Application.start()`. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('probe server did not expose a port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Application.run: real startup and shutdown with a live stream', () => {
  let app: Application;
  let testDataDir: string;
  let port: number;
  let graphId: string;
  let apiKeyId: string;
  let apiKeySecret: string;
  const exits: number[] = [];
  let listenersBefore: Map<string, Set<(...args: never[]) => void>>;

  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stream-shutdown-'));
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'stream-shutdown-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';

    port = await freePort();
    process.env.PORT = String(port);

    // Remember which signal listeners already existed so this suite can remove
    // exactly the ones `start()` adds and nothing else.
    listenersBefore = new Map(
      ['SIGTERM', 'SIGINT'].map((signal) => [
        signal,
        new Set(process.listeners(signal as NodeJS.Signals)),
      ])
    );

    app = new Application({ exit: (code) => exits.push(code) });
    await app.initialize();

    const container = getContainer();
    const graph = await container.graphRepository.create({ name: 'Stream Shutdown Graph' });
    graphId = graph.id;
    await container.graphRepository.setActiveGraph(graphId);

    const key = await container.authService.createApiKey({
      name: 'Stream Shutdown Key',
      permissions: ['write:events'],
    });
    apiKeyId = key.id;
    apiKeySecret = key.key;

    await app.start();
  });

  afterAll(async () => {
    for (const [signal, before] of listenersBefore) {
      for (const listener of process.listeners(signal as NodeJS.Signals)) {
        if (!before.has(listener)) {
          process.removeListener(signal as NodeJS.Signals, listener);
        }
      }
    }
    resetStreamTokenStore();
    delete process.env.PORT;
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('timed out waiting for a condition');
      }
      await sleep(10);
    }
  }

  it('serves HTTP on the configured port', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    // The container reports 503 until its lazy service getters have been
    // resolved (see src/tests/e2e/complete-workflow.test.ts). What matters here
    // is that the server `Application.start()` created is listening on the
    // configured port and answering through Express.
    expect([200, 503]).toContain(response.status);
    const body: unknown = await response.json();
    expect(isRecord(body)).toBe(true);
  });

  it('mints a token through the real route', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/stream/token`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKeySecret,
        'X-Graph-Id': graphId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(isRecord(body) && typeof body.token === 'string').toBe(true);
  });

  it('closes a live stream socket and exits 0 on SIGTERM', async () => {
    // Issued through the shared store the handler uses, so this exercises the
    // same wiring without depending on the token route's rate-limit budget (the
    // route itself is covered by the test above and in the stream suite).
    const record = getStreamTokenStore().issue({
      apiKeyId,
      graphId,
      permissions: ['write:events'],
    });

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}${STREAM_PATH}?token=${encodeURIComponent(record.token)}`
    );
    const received: Record<string, unknown>[] = [];
    ws.on('message', (data: RawData) => {
      received.push(readJsonObject(data));
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stream socket never opened')), 3000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    // The auth_result can only arrive if `Application.start()` attached the
    // handler's upgrade listener to the server it created.
    await waitFor(() => received.length > 0, 3000);
    expect(received[0]?.type).toBe('auth_result');
    expect(received[0]?.success).toBe(true);

    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    process.emit('SIGTERM');

    await Promise.race([
      closed,
      new Promise<void>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error('shutdown did not close the live stream socket')),
          5000
        );
      }),
    ]);
    expect(ws.readyState).toBe(WebSocket.CLOSED);

    // exit(0) is the last statement of the sequence, so observing it proves
    // `server.close()` completed: which it cannot while a WebSocket is open.
    await waitFor(() => exits.length > 0, 5000);
    expect(exits).toEqual([0]);
  });
});
