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

  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpRequestError';
    this.status = status;
    this.url = url;
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
            `HTTP ${response.status}: ${responseBody.slice(0, 500)}`
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
