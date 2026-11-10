/**
 * Tests for the injectable HTTP boundary's real request path.
 *
 * The allowlist and scheme rejections are covered in `LLMClients.test.ts`; these
 * tests cover what happens after a request is allowed to go out: the fetch call,
 * the returned body/headers, the timeout abort, and the error raised for a
 * non-2xx response. `globalThis.fetch` is stubbed, so no network is used.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  FetchHttpClient,
  HttpClient,
  HttpRequestError,
  HttpResponse,
  PoliteHttpClient,
  parseRetryAfterMs,
  wikimediaUserAgent,
} from './http';

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


describe('FetchHttpClient error headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries the response headers on an HttpRequestError, so Retry-After can be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'You are making too many requests',
        headers: new Headers({ 'Retry-After': '7' }),
      })
    );

    const error = await new FetchHttpClient(1000)
      .request({ url: 'https://en.wikipedia.org/w/api.php?page=X' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpRequestError);
    expect((error as HttpRequestError).status).toBe(429);
    expect((error as HttpRequestError).headers['retry-after']).toBe('7');
  });
});

describe('wikimediaUserAgent', () => {
  it('names the client and gives a contact, as the Wikimedia User-Agent policy requires', () => {
    expect(wikimediaUserAgent(undefined)).toBe('AlthistoryBot/1.0 (https://github.com/Qworg/althistory)');
  });

  it("adds the operator's contact, stripped of anything that would break the header", () => {
    expect(wikimediaUserAgent('ops@example.org')).toBe(
      'AlthistoryBot/1.0 (https://github.com/Qworg/althistory; ops@example.org)'
    );
    expect(wikimediaUserAgent('a(b);c\r\nX-Evil: 1')).toBe(
      'AlthistoryBot/1.0 (https://github.com/Qworg/althistory; abcX-Evil: 1)'
    );
  });
});

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds and HTTP-dates, and ignores junk', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    expect(parseRetryAfterMs('12', now)).toBe(12000);
    expect(parseRetryAfterMs('Thu, 05 Nov 2026 00:00:30 GMT', now)).toBe(30000);
    expect(parseRetryAfterMs('soon', now)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined();
  });
});

describe('PoliteHttpClient', () => {
  /** A fake clock whose sleep advances time instead of waiting. */
  function fakeClock() {
    let now = 1_000_000;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      sleeps,
    };
  }
  const ok: HttpResponse = { status: 200, body: '{}', headers: {} };
  const tooMany = (headers: Record<string, string> = {}) =>
    new HttpRequestError(429, 'https://en.wikipedia.org/w/api.php', 'HTTP 429', headers);

  it('spaces consecutive requests by the minimum interval', async () => {
    const clock = fakeClock();
    const inner: HttpClient = { request: vi.fn().mockResolvedValue(ok) };
    const client = new PoliteHttpClient(inner, { minIntervalMs: 400, ...clock });

    await client.request({ url: 'a' });
    await client.request({ url: 'b' });
    await client.request({ url: 'c' });

    expect(inner.request).toHaveBeenCalledTimes(3);
    expect(clock.sleeps).toEqual([400, 400]);
  });

  it('spaces concurrent callers too, since the slot is reserved before waiting', async () => {
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      const inner: HttpClient = {
        request: vi.fn(async () => {
          starts.push(Date.now());
          return ok;
        }),
      };
      // Real sleep and clock, both driven by the fake timers.
      const client = new PoliteHttpClient(inner, { minIntervalMs: 400 });

      const all = Promise.all([client.request({ url: 'a' }), client.request({ url: 'b' }), client.request({ url: 'c' })]);
      await vi.advanceTimersByTimeAsync(1000);
      await all;

      expect(starts.map((t) => t - starts[0])).toEqual([0, 400, 800]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits out Retry-After on a 429 and then succeeds', async () => {
    const clock = fakeClock();
    const inner: HttpClient = {
      request: vi.fn().mockRejectedValueOnce(tooMany({ 'retry-after': '3' })).mockResolvedValue(ok),
    };
    const client = new PoliteHttpClient(inner, { minIntervalMs: 0, ...clock });

    await expect(client.request({ url: 'a' })).resolves.toBe(ok);
    expect(inner.request).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([3000]);
  });

  it('backs off exponentially from five seconds when there is no Retry-After, then gives up', async () => {
    const clock = fakeClock();
    const inner: HttpClient = { request: vi.fn().mockRejectedValue(tooMany()) };
    const client = new PoliteHttpClient(inner, { minIntervalMs: 0, maxRetries: 3, ...clock });

    await expect(client.request({ url: 'a' })).rejects.toBeInstanceOf(HttpRequestError);
    expect(inner.request).toHaveBeenCalledTimes(4);
    expect(clock.sleeps).toEqual([5000, 10000, 20000]);
  });

  it('retries a 503 but not other failures', async () => {
    const clock = fakeClock();
    const unavailable = new HttpRequestError(503, 'u', 'HTTP 503');
    const retried: HttpClient = { request: vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValue(ok) };
    await expect(new PoliteHttpClient(retried, { minIntervalMs: 0, ...clock }).request({ url: 'a' })).resolves.toBe(ok);

    const notFound: HttpClient = { request: vi.fn().mockRejectedValue(new HttpRequestError(404, 'u')) };
    await expect(new PoliteHttpClient(notFound, { minIntervalMs: 0, ...clock }).request({ url: 'a' })).rejects.toThrow();
    expect(notFound.request).toHaveBeenCalledTimes(1);
  });

  it('does not sit out a Retry-After longer than its ceiling', async () => {
    const clock = fakeClock();
    const inner: HttpClient = { request: vi.fn().mockRejectedValue(tooMany({ 'retry-after': '3600' })) };
    const client = new PoliteHttpClient(inner, { minIntervalMs: 0, maxRetryDelayMs: 60000, ...clock });

    await expect(client.request({ url: 'a' })).rejects.toBeInstanceOf(HttpRequestError);
    expect(inner.request).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });
});
