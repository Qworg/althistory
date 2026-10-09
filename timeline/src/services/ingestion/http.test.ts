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

  describe('redirect handling and SSRF defense', () => {
    it('follows redirects to allowed endpoints', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Headers({
            location: 'https://en.wikipedia.org/wiki/Target',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => 'target content',
          headers: new Headers({ 'content-type': 'text/html' }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = new FetchHttpClient(1000);
      const res = await client.request({ url: 'https://en.wikipedia.org/wiki/Source' });

      expect(res.status).toBe(200);
      expect(res.body).toBe('target content');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://en.wikipedia.org/wiki/Source',
        expect.objectContaining({ redirect: 'manual' })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://en.wikipedia.org/wiki/Target',
        expect.objectContaining({ redirect: 'manual' })
      );
    });

    it('blocks redirects to disallowed external hosts or internal SSRF targets', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({
          location: 'https://169.254.169.254/latest/meta-data',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new FetchHttpClient(1000);
      await expect(
        client.request({ url: 'https://en.wikipedia.org/wiki/Source' })
      ).rejects.toThrow(/Refusing request to disallowed host: 169.254.169.254/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('blocks redirects to non-HTTPS schemes', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({
          location: 'http://en.wikipedia.org/wiki/Target',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new FetchHttpClient(1000);
      await expect(
        client.request({ url: 'https://en.wikipedia.org/wiki/Source' })
      ).rejects.toThrow(/Refusing non-HTTPS request/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects redirect without Location header', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 301,
        headers: new Headers(),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new FetchHttpClient(1000);
      await expect(
        client.request({ url: 'https://en.wikipedia.org/wiki/Source' })
      ).rejects.toThrow(/redirect without Location header/);
    });

    it('rejects redirect loops exceeding maximum hop limit', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({
          location: 'https://en.wikipedia.org/wiki/Loop',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new FetchHttpClient(1000);
      await expect(
        client.request({ url: 'https://en.wikipedia.org/wiki/Loop' })
      ).rejects.toThrow(/Exceeded maximum redirect limit of 5/);

      expect(fetchMock).toHaveBeenCalledTimes(6);
    });
  });
});

