/**
 * An HTTP client for documents on the open web.
 *
 * The Wikipedia and Wikidata extractors fetch from a fixed allowlist, because
 * their input is a user-supplied URL and an unrestricted fetch would let a
 * caller reach services inside the network the daemon runs in. The web
 * document ingestion has the same shape of risk but no fixed allowlist to
 * lean on, so this client applies the rules that can be checked without
 * resolving names:
 *
 * - the scheme must be HTTPS;
 * - the host must not be a loopback, link-local, private or otherwise
 *   internal address, neither as a literal nor as a name that is reserved for
 *   internal use (`localhost`, `*.local`, `*.internal`);
 * - redirects are followed, and every hop is checked again;
 * - a host name is resolved, and the fetch is refused when *any* address it
 *   resolves to is internal -- checking the name's literal text alone would
 *   let `127.0.0.1.nip.io` or an attacker's own `A` record reach the loopback
 *   or the link-local metadata address;
 * - the body is read as a stream and is refused once it grows past the size
 *   cap, so a page that never ends is not buffered in full.
 *
 * What this does not close is a name that resolves externally for the check
 * and internally for the connection (DNS rebinding): `fetch` resolves the
 * name again when it connects. Closing that needs the connection pinned to
 * the checked address, which the standard `fetch` does not expose. The gap is
 * named here rather than papered over.
 */

import { isIP } from 'net';
import { lookup } from 'dns/promises';
import { HttpClient, HttpRequest, HttpResponse, HttpRequestError } from './http';

const DEFAULT_TIMEOUT_MS = 15000;

/** The largest document the client will read, in bytes. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Host names that always name the local machine or an internal network. */
const RESERVED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/**
 * Normalise a host for the internal-address checks.
 *
 * A URL keeps the brackets of an IPv6 literal (`https://[::1]/` has the
 * hostname `[::1]`), and a name may carry a trailing dot. Both are removed
 * here, so the checks below see the address itself.
 */
export function normalizeHost(rawHost: string): string {
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  // A zone index (`fe80::1%eth0`) names a link-local address too.
  const zone = host.indexOf('%');
  if (zone >= 0) {
    host = host.slice(0, zone);
  }
  if (host.endsWith('.') && !host.endsWith('..')) {
    host = host.slice(0, -1);
  }
  return host;
}

/** Whether an IPv4 address is one that is not reachable from the open web. */
export function isInternalIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && parts[2] === 0) return true; // protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true; // documentation
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // documentation
  if (a === 203 && b === 0 && parts[2] === 113) return true; // documentation
  if (a >= 224) return true; // multicast, reserved and broadcast
  return false;
}

/**
 * Parse an IPv6 address into its sixteen bytes.
 *
 * Returns `null` for anything that is not an IPv6 address. The embedded IPv4
 * form (`::ffff:127.0.0.1`) is expanded, so the caller can read the IPv4
 * address out of it.
 */
export function parseIPv6Bytes(address: string): number[] | null {
  if (isIP(address) !== 6) return null;

  let text = address;
  const embedded = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) {
    const quads = embedded[1].split('.').map((part) => Number(part));
    if (quads.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const high = ((quads[0] << 8) | quads[1]).toString(16);
    const low = ((quads[2] << 8) | quads[3]).toString(16);
    text = `${text.slice(0, text.length - embedded[1].length)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toBytes = (part: string): string[] => (part === '' ? [] : part.split(':'));
  let groups: string[];
  if (halves.length === 2) {
    const head = toBytes(halves[0]);
    const tail = toBytes(halves[1]);
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<string>(fill).fill('0'), ...tail];
  } else {
    groups = toBytes(halves[0]);
  }
  if (groups.length !== 8) return null;
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  // Every group is a hextet, which is two bytes.
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/** Whether an IPv6 address is one that is not reachable from the open web. */
export function isInternalIPv6(address: string): boolean {
  const bytes = parseIPv6Bytes(address);
  if (!bytes) return false;

  const isZeroPrefix = (count: number): boolean => bytes.slice(0, count).every((byte) => byte === 0);

  // The unspecified address and the loopback address.
  if (isZeroPrefix(15) && bytes[15] === 0) return true;
  if (isZeroPrefix(15) && bytes[15] === 1) return true;

  // An IPv4-mapped (`::ffff:a.b.c.d`) or NAT64 (`64:ff9b::/96`) address names
  // the IPv4 address it carries.
  const isIpv4Mapped = isZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0);
  if (isIpv4Mapped || isNat64) {
    const mapped = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isInternalIPv4(mapped);
  }

  // The unique local range (`fc00::/7`).
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  // The link-local range (`fe80::/10`).
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  // The site-local range (`fec0::/10`).
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true;
  // Multicast (`ff00::/8`).
  if (bytes[0] === 0xff) return true;
  // The documentation range (`2001:db8::/32`).
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

  return false;
}

/**
 * Whether a host names an address that is not reachable from the open web.
 *
 * The host is matched as an address, not as a prefix of a name: a host called
 * `fda.gov` is an ordinary public host, while `fd00::1` is a private one.
 */
export function isInternalHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized === 'ip6-localhost' || normalized === 'ip6-loopback') {
    return true;
  }
  if (RESERVED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  const version = isIP(normalized);
  if (version === 4) return isInternalIPv4(normalized);
  if (version === 6) return isInternalIPv6(normalized);
  return false;
}

/**
 * How a host name is turned into the addresses it names.
 *
 * Injected so the tests can answer without asking a real resolver.
 */
export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (host) => {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Whether a resolved address is one the client must not connect to.
 *
 * The value is an address rather than a name, so this is the address check
 * alone.
 */
export function isInternalAddress(address: string): boolean {
  const version = isIP(normalizeHost(address));
  if (version === 4) return isInternalIPv4(normalizeHost(address));
  if (version === 6) return isInternalIPv6(normalizeHost(address));
  // Not an address at all: treat it as internal rather than letting it past.
  return true;
}

/**
 * Validate a URL for a web document fetch.
 *
 * Throws when the URL cannot be fetched safely; the message names the reason
 * so the CLI can report it.
 */
export function assertPublicWebUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing to fetch ${parsed.protocol}//${parsed.host}: web documents must be served over HTTPS`);
  }
  if (isInternalHost(parsed.hostname)) {
    throw new Error(`Refusing to fetch an internal host: ${parsed.hostname}`);
  }
  return parsed;
}

/**
 * Validate a URL, including the addresses its host name resolves to.
 *
 * A literal address is already checked by {@link assertPublicWebUrl}. A name
 * is resolved, and the fetch is refused when any address it names is
 * internal: a public-looking name is not evidence of a public destination.
 */
export async function assertPublicWebUrlResolved(
  rawUrl: string,
  resolver: HostResolver = defaultResolver
): Promise<URL> {
  const parsed = assertPublicWebUrl(rawUrl);

  const host = normalizeHost(parsed.hostname);
  if (isIP(host) !== 0) {
    // A literal address: `assertPublicWebUrl` has already checked it.
    return parsed;
  }

  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch (error) {
    throw new Error(
      `Could not resolve ${parsed.hostname}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (addresses.length === 0) {
    throw new Error(`Could not resolve ${parsed.hostname}: it names no address`);
  }

  for (const address of addresses) {
    if (isInternalAddress(address)) {
      throw new Error(
        `Refusing to fetch ${parsed.hostname}: it resolves to the internal address ${address}`
      );
    }
  }

  return parsed;
}

/**
 * An {@link HttpClient} that fetches documents from the open web.
 */
export class PublicWebHttpClient implements HttpClient {
  private readonly defaultTimeoutMs: number;
  private readonly resolver: HostResolver;

  constructor(defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS, resolver: HostResolver = defaultResolver) {
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.resolver = resolver;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? this.defaultTimeoutMs);

    let currentUrl = request.url;
    let redirects = 0;

    try {
      while (redirects <= 5) {
        // Every hop is checked, and every hop's name is resolved: a redirect
        // to a public-looking name that points at the loopback is refused
        // just as a redirect to `127.0.0.1` is.
        const validated = await assertPublicWebUrlResolved(currentUrl, this.resolver);
        const safeUrl: string = validated.toString();

        const response = await fetch(safeUrl, {
          method: request.method ?? 'GET',
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
          redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new HttpRequestError(response.status, currentUrl, `HTTP ${response.status} redirect without Location header`);
          }
          redirects++;
          if (redirects > 5) {
            throw new Error('Exceeded maximum redirect limit of 5');
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        if (!response.ok) {
          throw new HttpRequestError(response.status, currentUrl, `HTTP ${response.status}`);
        }

        // The body is read after the status is known to be good, so an error
        // page does not have to be read at all.
        const body = await this.readBoundedBody(response);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        return { status: response.status, body, headers };
      }

      throw new Error('Exceeded maximum redirect limit of 5');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the body, refusing to hold more than the size cap in memory.
   *
   * The body is read as a stream and the running total is measured in bytes
   * of the body as it arrives, which is the decompressed size: a compressed
   * response that expands past the cap is refused as well, and a page that
   * keeps sending is stopped at the cap instead of being buffered whole.
   */
  private async readBoundedBody(response: Response): Promise<string> {
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
      throw new Error(`Document is larger than the ${MAX_DOCUMENT_BYTES}-byte limit`);
    }

    const stream = response.body;
    if (!stream) return '';

    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let total = 0;
    let text = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_DOCUMENT_BYTES) {
          await reader.cancel();
          throw new Error(`Document is larger than the ${MAX_DOCUMENT_BYTES}-byte limit`);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }

    return text;
  }
}
