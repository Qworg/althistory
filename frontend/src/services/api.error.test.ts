/**
 * How the API client reports a server error.
 *
 * The backend's error handler answers with `{ error: { message, details, ... } }`.
 * The client used to read only a flat `message`, so every server error reached
 * the user as axios's own "Request failed with status code 400" -- the reason
 * was thrown away. A validation message that names the offending field is the
 * whole point of the server sending one, so this is worth a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

/** A response the backend's error handler would produce. */
function serverError(status: number, data: unknown): unknown {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: `Request failed with status code ${status}`,
    request: {},
    response: { status, data, headers: {}, config: {} },
  };
}

/** Replace the axios factory so the client uses a transport we control. */
function mockTransport(post: ReturnType<typeof vi.fn>): void {
  vi.spyOn(axios, 'create').mockReturnValue({
    post,
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: { headers: { common: {} } },
  } as never);
}

describe('API error reporting', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces the message the backend nested under `error`', async () => {
    mockTransport(
      vi.fn().mockRejectedValue(
        serverError(400, {
          error: {
            message:
              "The merge was refused: The merged event 'e1' is not usable: timestamp must stay a string",
            details: { field: 'manualResolutions' },
          },
        })
      )
    );

    const { apiClient } = await import('./api');

    await expect(
      apiClient.graphs.mergeDetailed('graph-1', {
        sourceGraphId: 'graph-2',
        conflictResolution: 'manual',
      })
    ).rejects.toThrow(/timestamp must stay a string/);
  });

  it('still falls back to a flat message', async () => {
    mockTransport(
      vi.fn().mockRejectedValue(serverError(400, { message: 'flat message' }))
    );

    const { apiClient } = await import('./api');

    await expect(
      apiClient.graphs.mergeDetailed('graph-1', {
        sourceGraphId: 'graph-2',
        conflictResolution: 'manual',
      })
    ).rejects.toThrow(/flat message/);
  });

  it('falls back to the transport message when the body carries no reason', async () => {
    mockTransport(vi.fn().mockRejectedValue(serverError(500, {})));

    const { apiClient } = await import('./api');

    await expect(
      apiClient.graphs.mergeDetailed('graph-1', {
        sourceGraphId: 'graph-2',
        conflictResolution: 'manual',
      })
    ).rejects.toThrow(/Request failed with status code 500/);
  });
});
