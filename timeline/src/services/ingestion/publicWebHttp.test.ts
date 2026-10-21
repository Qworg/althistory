/**
 * The guard on the open web.
 *
 * The web document extractor fetches a URL the caller supplies, so the client
 * that fetches it has to refuse the addresses that are not on the open web.
 * These tests cover the three things that can go wrong: an address that slips
 * through the check, an address that is refused although it is a perfectly
 * ordinary public host, and a document that is bigger than the cap.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  PublicWebHttpClient,
  assertPublicWebUrl,
  assertPublicWebUrlResolved,
  isInternalHost,
  MAX_DOCUMENT_BYTES,
  type HostResolver,
} from './publicWebHttp';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isInternalHost', () => {
  it('refuses the private and the loopback IPv4 addresses', () => {
    for (const host of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '255.255.255.255',
    ]) {
      expect(isInternalHost(host), host).toBe(true);
    }
  });

  it('allows the public IPv4 addresses', () => {
    for (const host of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '93.184.216.34']) {
      expect(isInternalHost(host), host).toBe(false);
    }
  });

  it('refuses the internal IPv6 addresses, brackets and all', () => {
    for (const host of [
      '::1',
      '[::1]',
      '0:0:0:0:0:0:0:1',
      '::',
      'fd00::1',
      '[fd00::1]',
      'fc00::1',
      'fe80::1',
      'febf::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '[::ffff:127.0.0.1]',
    ]) {
      expect(isInternalHost(host), host).toBe(true);
    }
  });

  it('refuses every IPv6 form that carries an internal IPv4 address', () => {
    // Each of these names 127.0.0.1 through a different IPv6 form. Checking
    // only the mapped form leaves the others as a way to name the loopback.
    for (const host of [
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]',
      '[::127.0.0.1]',
      '[::7f00:1]',
      '[::ffff:0:127.0.0.1]',
      '[2002:7f00:1::]',
      '[2001:0000:7f00:1::]',
    ]) {
      expect(isInternalHost(host)).toBe(true);
    }
  });

  it('still allows a 6to4 address that carries a public IPv4 address', () => {
    expect(isInternalHost('[2002:5db8:d822::]')).toBe(false);
  });

  it('allows the public IPv6 addresses', () => {
    for (const host of ['2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4001:80f::200e']) {
      expect(isInternalHost(host), host).toBe(false);
    }
  });

  it('does not mistake a name that starts with fc or fd for an address', () => {
    for (const host of ['fda.gov', 'fcc.gov', 'fdrlibrary.org', 'fcbarcelona.com', 'f-d.example.org']) {
      expect(isInternalHost(host), host).toBe(false);
    }
  });

  it('refuses the names that are reserved for internal use', () => {
    for (const host of ['localhost', 'ip6-localhost', 'printer.local', 'db.internal', 'host.home.arpa']) {
      expect(isInternalHost(host), host).toBe(true);
    }
  });
});

describe('assertPublicWebUrl', () => {
  it('refuses a URL that is not served over HTTPS', () => {
    expect(() => assertPublicWebUrl('http://example.org/history')).toThrow(/HTTPS/);
  });

  it('refuses a URL that names an internal address', () => {
    expect(() => assertPublicWebUrl('https://127.0.0.1/history')).toThrow(/internal host/);
    expect(() => assertPublicWebUrl('https://[::1]/history')).toThrow(/internal host/);
    expect(() => assertPublicWebUrl('https://[fd00::1]/history')).toThrow(/internal host/);
    expect(() => assertPublicWebUrl('https://localhost/history')).toThrow(/internal host/);
  });

  it('accepts an ordinary public URL', () => {
    const parsed = assertPublicWebUrl('https://example.org/history');
    expect(parsed.hostname).toBe('example.org');
  });

  it('refuses a URL it cannot read', () => {
    expect(() => assertPublicWebUrl('not a url')).toThrow(/Invalid URL/);
  });
});

/**
 * A resolver that answers from a table instead of from the network.
 *
 * The client is given one in every test: without it the tests would depend on
 * `example.org` really resolving.
 */
function resolverFor(table: Record<string, string[]>): HostResolver {
  return async (host) => {
    const addresses = table[host];
    if (!addresses) {
      throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    }
    return addresses;
  };
}

const PUBLIC = resolverFor({
  'example.org': ['93.184.216.34'],
  'public.example': ['93.184.216.35'],
});

describe('assertPublicWebUrlResolved', () => {
  it('refuses a public-looking name that resolves to the loopback', async () => {
    // `127.0.0.1.nip.io` and `sslip.io` are the classic way round a check
    // that only reads the URL's text: the name is public, the address is not.
    const resolver = resolverFor({ '127.0.0.1.nip.io': ['127.0.0.1'] });

    await expect(
      assertPublicWebUrlResolved('https://127.0.0.1.nip.io/history', resolver)
    ).rejects.toThrow(/resolves to the internal address 127\.0\.0\.1/);
  });

  it('refuses a name that resolves to the link-local metadata address', async () => {
    const resolver = resolverFor({ 'metadata.example': ['169.254.169.254'] });

    await expect(
      assertPublicWebUrlResolved('https://metadata.example/latest', resolver)
    ).rejects.toThrow(/internal address/);
  });

  it('refuses a name when *any* of its addresses is internal', async () => {
    // A name with several `A` records is not safe just because the first one
    // is public: the connection may go to any of them.
    const resolver = resolverFor({ 'split.example': ['93.184.216.34', '10.0.0.7'] });

    await expect(
      assertPublicWebUrlResolved('https://split.example/history', resolver)
    ).rejects.toThrow(/10\.0\.0\.7/);
  })

  it('refuses a name that resolves to an internal IPv6 address', async () => {
    const resolver = resolverFor({ 'six.example': ['fd00::1'] });

    await expect(
      assertPublicWebUrlResolved('https://six.example/history', resolver)
    ).rejects.toThrow(/internal address/);
  });

  it('gives up on a DNS lookup that never answers', async () => {
    // The abort timer covers the fetch, not the lookup: a resolver that never
    // answers would otherwise hold the request open past its own timeout.
    const resolver: HostResolver = () => new Promise<string[]>(() => {});

    await expect(
      assertPublicWebUrlResolved('https://slow.example/history', resolver, 10)
    ).rejects.toThrow(/did not answer within 10 ms/);
  });

  it('refuses a name that cannot be resolved', async () => {
    const resolver = resolverFor({});

    await expect(
      assertPublicWebUrlResolved('https://nowhere.example/history', resolver)
    ).rejects.toThrow(/Could not resolve nowhere\.example/);
  });

  it('refuses a name that resolves to nothing', async () => {
    const resolver = resolverFor({ 'empty.example': [] });

    await expect(
      assertPublicWebUrlResolved('https://empty.example/history', resolver)
    ).rejects.toThrow(/names no address/);
  });

  it('accepts a name that resolves only to public addresses', async () => {
    const resolver = resolverFor({ 'example.org': ['93.184.216.34', '2606:2800:220:1::1'] });

    await expect(
      assertPublicWebUrlResolved('https://example.org/history', resolver)
    ).resolves.toBeInstanceOf(URL);
  });

  it('does not resolve a literal address, because it has already been checked', async () => {
    let asked = false;
    const resolver: HostResolver = async () => {
      asked = true;
      return ['10.0.0.1'];
    };

    await expect(
      assertPublicWebUrlResolved('https://93.184.216.34/history', resolver)
    ).resolves.toBeInstanceOf(URL);
    expect(asked).toBe(false);
  });
});

describe('PublicWebHttpClient', () => {
  it('never asks for an internal address', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new PublicWebHttpClient(undefined, PUBLIC);
    await expect(client.request({ url: 'https://127.0.0.1/history' })).rejects.toThrow(/internal host/);
    await expect(client.request({ url: 'https://[::1]/history' })).rejects.toThrow(/internal host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks every hop of a redirect', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://[::1]/history' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new PublicWebHttpClient(undefined, PUBLIC);
    await expect(client.request({ url: 'https://example.org/history' })).rejects.toThrow(/internal host/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a name that resolves to an internal address', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const internal = resolverFor({ '127.0.0.1.nip.io': ['127.0.0.1'] });
    const client = new PublicWebHttpClient(undefined, internal);

    await expect(client.request({ url: 'https://127.0.0.1.nip.io/history' })).rejects.toThrow(
      /internal address/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the addresses of every redirect hop, not only its text', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://metadata.example/latest' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const resolver = resolverFor({
      'example.org': ['93.184.216.34'],
      'metadata.example': ['169.254.169.254'],
    });
    const client = new PublicWebHttpClient(undefined, resolver);

    await expect(client.request({ url: 'https://example.org/history' })).rejects.toThrow(
      /internal address/
    );
    // The first hop was fetched; the second was refused before it was.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads an ordinary document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<p>hello</p>', { status: 200, headers: { 'content-type': 'text/html' } }))
    );

    const client = new PublicWebHttpClient(undefined, PUBLIC);
    const response = await client.request({ url: 'https://example.org/history' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('<p>hello</p>');
    expect(response.headers['content-type']).toBe('text/html');
  });

  it('refuses a document that is larger than the cap, in bytes', async () => {
    // Three million two-byte characters are six megabytes, and the cap is
    // five: counting the characters instead of the bytes would let this
    // through.
    const oversized = 'é'.repeat(3 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized, { status: 200 })));

    const client = new PublicWebHttpClient(undefined, PUBLIC);
    await expect(client.request({ url: 'https://example.org/big' })).rejects.toThrow(/larger than/);
  });

  it('refuses a document that grows past the cap while it is being read', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 }))
    );

    const client = new PublicWebHttpClient(undefined, PUBLIC);
    await expect(client.request({ url: 'https://example.org/stream' })).rejects.toThrow(/larger than/);
  });

  it('accepts a document that stays inside the cap', async () => {
    const body = 'x'.repeat(1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const client = new PublicWebHttpClient(undefined, PUBLIC);
    const response = await client.request({ url: 'https://example.org/small' });
    expect(response.body).toBe(body);
  });

  it('reports the cap it enforces', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(5 * 1024 * 1024);
  });
});
