/**
 * Cancelling an MCP generation call stops the app's job (issue 23).
 *
 * The client says `notifications/cancelled` with the id of the call it gave up
 * on. This fails if the server drops that notification (the call's signal never
 * aborts, so the app's job keeps spending the model key) or if the signal is
 * not handed to the engine at all.
 */

import { describe, it, expect } from 'vitest';
import type { IEngine, GenerationRunHooks } from './../engine/IEngine';
import { McpServer } from './McpServer';

/** An engine whose generation runs until its signal aborts. */
function engineThatRunsUntilAborted(seen: { signal?: AbortSignal }): IEngine {
  const run = (_options: unknown, hooks?: GenerationRunHooks): Promise<never> =>
    new Promise((_resolve, reject) => {
      seen.signal = hooks?.signal;
      if (!hooks?.signal) return;
      hooks.signal.addEventListener('abort', () => reject(new Error('Cancelled; 0 events stay')));
    });
  return { generateTimeline: run, generateBranch: run } as unknown as IEngine;
}

const call = (id: number, name: string, args: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

describe('MCP cancellation', () => {
  it('aborts the call named by notifications/cancelled, and only that one', async () => {
    const first: { signal?: AbortSignal } = {};
    const server = new McpServer(engineThatRunsUntilAborted(first));
    const running = server.handleMessage(call(7, 'althistory_generate_timeline', { premise: 'A tide that never turns' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.signal).toBeDefined();
    expect(first.signal?.aborted).toBe(false);

    // Another call's id changes nothing.
    expect(await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 8 } }))).toBeNull();
    expect(first.signal?.aborted).toBe(false);

    expect(await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }))).toBeNull();
    expect(first.signal?.aborted).toBe(true);
    const response = JSON.parse((await running) as string);
    expect(response.id).toBe(7);
    expect(response.result.isError ?? response.error).toBeTruthy();
  });

  it('hands a branch call its signal too', async () => {
    const seen: { signal?: AbortSignal } = {};
    const server = new McpServer(engineThatRunsUntilAborted(seen));
    const running = server.handleMessage(
      call(3, 'althistory_branch_timeline', {
        sourceGraphId: 'g',
        divergeAtEventId: 'e',
        counterfactualPrompt: 'what if',
        branchName: 'b',
      })
    );
    await new Promise((resolve) => setImmediate(resolve));
    await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }));
    expect(seen.signal?.aborted).toBe(true);
    await running;
  });

  it('forgets a finished call, so a late cancel does nothing', async () => {
    const server = new McpServer({ listGraphs: async () => [] } as unknown as IEngine);
    await server.handleMessage(call(1, 'althistory_list_graphs', {}));
    expect(
      await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }))
    ).toBeNull();
  });
});
