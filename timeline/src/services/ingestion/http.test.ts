/**
 * Tests for the injectable HTTP boundary's real request path.
 *
 * The allowlist and scheme rejections are covered in `LLMClients.test.ts`; these
 * tests cover what happens after a request is allowed to go out: the fetch call,
 * the returned body/headers, the timeout abort, and the error raised for a
 * non-2xx response. `globalThis.fetch` is stubbed, so no network is used.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { FetchHttpClient, HttpRequestError } from './http';

describe('FetchHttpClient request path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response body and lower-cased headers on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"parse":{"title":"X"}}',
      headers: new Headers({ 'Content-Type': 'application/json' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await new FetchHttpClient(1000).request({
      url: 'https://en.wikipedia.org/w/api.php?page=X',
      method: 'POST',
      headers: { 'User-Agent': 'test-agent' },
      body: 'a=b',
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('{"parse":{"title":"X"}}');
    expect(response.headers['content-type']).toBe('application/json');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://en.wikipedia.org/w/api.php?page=X',
      expect.objectContaining({
        method: 'POST',
        headers: { 'User-Agent': 'test-agent' },
        body: 'a=b',
      })
    );
  });

  it('defaults the method to GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new FetchHttpClient(1000).request({ url: 'https://query.wikidata.org/sparql' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://query.wikidata.org/sparql',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('raises HttpRequestError carrying the status, URL and body excerpt for a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
        headers: new Headers(),
      })
    );
    const client = new FetchHttpClient(1000);
    const url = 'https://query.wikidata.org/sparql';

    await expect(client.request({ url })).rejects.toBeInstanceOf(HttpRequestError);
    await expect(client.request({ url })).rejects.toMatchObject({
      name: 'HttpRequestError',
      status: 503,
      url,
    });
    await expect(client.request({ url })).rejects.toThrow(/service unavailable/);
  });

  it('aborts the request when the timeout elapses', async () => {
    let aborted = false;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      void url;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new FetchHttpClient(10).request({ url: 'https://en.wikipedia.org/w/api.php' })
    ).rejects.toThrow(/aborted/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(aborted).toBe(true);
  });

  it('refuses a URL that does not parse, before calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new FetchHttpClient(1000).request({ url: 'not a url' })).rejects.toThrow(
      /Invalid request URL/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
