/**
 * Injectable HTTP boundary for external ingestion.
 *
 * Every network call an extractor or LLM client makes goes through
 * {@link HttpClient}. Production uses {@link FetchHttpClient}; tests inject a
 * fake backed by recorded fixtures, so the suite never touches the network and
 * never needs an API key.
 *
 * `FetchHttpClient` restricts outbound requests to an allowlist of hosts. The
 * Wikipedia extractor takes a user-supplied URL, so without this an attacker
 * could point ingestion at internal services (SSRF). The allowlist covers only
 * the hosts the extractors fetch: Wikipedia language subdomains and the
 * Wikidata query endpoint. The LLM clients use the official SDKs, not this
 * client.
 */

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}

/** Thrown when a request completes with a non-2xx status. */
export class HttpRequestError extends Error {
  readonly status: number;
  readonly url: string;
  /** Lower-cased response headers, when the request got a response. */
  readonly headers: Record<string, string>;

  constructor(status: number, url: string, message?: string, headers: Record<string, string> = {}) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpRequestError';
    this.status = status;
    this.url = url;
    this.headers = headers;
  }
}

/** Whether an upstream refused for load (429) or was overloaded (503). */
export function isRateLimited(error: HttpRequestError): boolean {
  return error.status === 429 || error.status === 503;
}

/**
 * Parse a `Retry-After` header (delta-seconds or an HTTP-date) into
 * milliseconds from `nowMs`. Returns undefined when absent or unparseable.
 */
export function parseRetryAfterMs(value: string | undefined, nowMs: number): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

/**
 * The User-Agent every Wikimedia request sends.
 *
 * Wikimedia's 2026 rate limits give a request with nothing identifying it but
 * its IP 10 requests a minute, and an unauthenticated bot with a compliant
 * User-Agent 200 (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits).
 * Compliant means `<name>/<version> (<contact>)`, the contact being a website,
 * email or wiki user (Wikimedia Foundation User-Agent Policy). The old
 * `AlthistoryIngestion/1.0 (local research tool)` carried no contact, so a
 * 50-page crawl hit 429 after about ten pages.
 *
 * The project URL is always the contact; `WIKIMEDIA_CONTACT` (an email or
 * `User:Name`) adds the operator's own, which Wikimedia prefers.
 */
export function wikimediaUserAgent(
  contact: string | undefined = process.env.WIKIMEDIA_CONTACT
): string {
  // Header values cannot carry control characters, and parentheses or
  // semicolons would break the contact list's syntax.
  const extra = Array.from(contact ?? '')
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f && !'();'.includes(ch))
    .join('')
    .trim();
  const contacts = ['https://github.com/Qworg/althistory', ...(extra ? [extra] : [])].join('; ');
  return `AlthistoryBot/1.0 (${contacts})`;
}

export interface PoliteHttpClientOptions {
  /** Minimum gap between the starts of two requests. */
  minIntervalMs?: number;
  /** How many times a 429/503 is retried before it is thrown. */
  maxRetries?: number;
  /** First backoff when the response has no Retry-After; doubles each retry. */
  baseRetryDelayMs?: number;
  /** A requested wait longer than this is not waited out: the error is thrown. */
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Paces requests to a shared upstream and retries the ones it refuses for
 * load, honouring `Retry-After` (Wikimedia's rate-limit guidance: respect it,
 * and without it wait at least five seconds or back off exponentially).
 *
 * One instance is shared by every request in the process, so its pacing holds
 * across concurrent ingestions, and a backoff delays everyone queued behind it
 * rather than letting them run into the same 429.
 */
export class PoliteHttpClient implements HttpClient {
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** The earliest time the next request may start. */
  private nextSlotMs = 0;

  constructor(
    private readonly inner: HttpClient,
    options: PoliteHttpClientOptions = {}
  ) {
    // 400 ms is 150 requests a minute: under the 200 a compliant client gets.
    this.minIntervalMs = options.minIntervalMs ?? 400;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 5000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 60000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      try {
        return await this.inner.request(request);
      } catch (error) {
        if (
          !(error instanceof HttpRequestError) ||
          !isRateLimited(error) ||
          attempt >= this.maxRetries
        ) {
          throw error;
        }
        const delayMs =
          parseRetryAfterMs(error.headers['retry-after'], this.now()) ??
          this.baseRetryDelayMs * 2 ** attempt;
        if (delayMs > this.maxRetryDelayMs) throw error;
        this.nextSlotMs = Math.max(this.nextSlotMs, this.now() + delayMs);
      }
    }
  }

  /** Reserve the next start time synchronously, then wait for it. */
  private async waitForSlot(): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlotMs);
    this.nextSlotMs = slot + this.minIntervalMs;
    if (slot > now) await this.sleep(slot - now);
  }
}

/** The JSON shapes `parseJsonBody` can return. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const DEFAULT_TIMEOUT_MS = 15000;

/** Exact hosts permitted by default. */
const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['query.wikidata.org'];

/** Host suffixes permitted by default (Wikipedia language subdomains). */
const DEFAULT_ALLOWED_HOST_SUFFIXES: readonly string[] = ['.wikipedia.org', '.wikidata.org'];

/**
 * `fetch`-backed client. Node 18+ provides global `fetch`; the backend targets
 * Node 20. No HTTP dependency is added because the platform already ships one.
 */
export class FetchHttpClient implements HttpClient {
  private readonly defaultTimeoutMs: number;
  private readonly allowedHosts: readonly string[];
  private readonly allowedHostSuffixes: readonly string[];

  constructor(
    defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS,
    allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS,
    allowedHostSuffixes: readonly string[] = DEFAULT_ALLOWED_HOST_SUFFIXES
  ) {
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.allowedHosts = allowedHosts;
    this.allowedHostSuffixes = allowedHostSuffixes;
  }

  /**
   * Validate scheme and host against the allowlist and return the normalized
   * URL string. Returning the validated value keeps the `fetch` call on the
   * checked URL rather than re-reading the raw request property.
   */
  private assertAllowedUrl(rawUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid request URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:') {
      throw new Error(`Refusing non-HTTPS request to ${parsed.host}`);
    }

    const host = parsed.hostname.toLowerCase();
    const allowed =
      this.allowedHosts.includes(host) ||
      this.allowedHostSuffixes.some((suffix) => host.endsWith(suffix));
    if (!allowed) {
      throw new Error(`Refusing request to disallowed host: ${host}`);
    }

    return parsed.toString();
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let currentUrl = request.url;
    let method: HttpMethod = request.method ?? 'GET';
    let body = request.body;
    let redirectCount = 0;
    const maxRedirects = 5;

    try {
      while (redirectCount <= maxRedirects) {
        const validatedEndpoint = this.assertAllowedUrl(currentUrl);

        const response = await fetch(validatedEndpoint, {
          method,
          headers: request.headers,
          body,
          signal: controller.signal,
          redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new HttpRequestError(
              response.status,
              currentUrl,
              `HTTP ${response.status} redirect without Location header`
            );
          }

          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new Error(`Exceeded maximum redirect limit of ${maxRedirects}`);
          }

          const nextUrl = new URL(location, currentUrl).toString();
          // Re-verify the destination URL against host and protocol rules
          this.assertAllowedUrl(nextUrl);

          currentUrl = nextUrl;
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method === 'POST')
          ) {
            method = 'GET';
            body = undefined;
          }
          continue;
        }

        const responseBody = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        if (!response.ok) {
          throw new HttpRequestError(
            response.status,
            currentUrl,
            `HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
            headers
          );
        }

        return { status: response.status, body: responseBody, headers };
      }

      throw new Error(`Exceeded maximum redirect limit of ${maxRedirects}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse a JSON response body, raising a labelled error when it is not JSON. */
export function parseJsonBody(body: string, label: string): JsonValue {
  try {
    return JSON.parse(body) as JsonValue;
  } catch {
    throw new Error(`${label}: response was not valid JSON`);
  }
}
