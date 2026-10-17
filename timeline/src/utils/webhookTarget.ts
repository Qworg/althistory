/**
 * Validation for caller-supplied webhook targets.
 *
 * A job's `webhookUrl` comes from the API request body, so posting to it is an
 * outbound request driven by caller input (CWE-918). The rules here are a
 * deliberate default rather than an exhaustive SSRF defence:
 *
 *   - scheme allowlist: `http:` or `https:` only
 *   - no embedded credentials (`https://user:pass@host`)
 *   - no loopback/private/link-local destination, so a webhook cannot be aimed
 *     at the process's own admin surface or the cloud metadata endpoint
 *
 * Only literal addresses are checked. A hostname that resolves to a private
 * address is not caught here (that needs a resolver, and DNS can change between
 * check and connect); deployments that need that guarantee should route
 * egress through a network policy. Internal targets can be enabled per
 * deployment by extending the policy, which is why the private-address rule
 * lives behind an option rather than being unconditional.
 */

export interface WebhookTargetPolicy {
  /** Permit loopback/private/link-local destinations (default false). */
  allowPrivateHosts?: boolean;
}

const PRIVATE_IPV4_PREFIXES: readonly string[] = [
  '0.', // "this" network
  '10.', // private
  '127.', // loopback
  '169.254.', // link-local (cloud metadata)
  '192.168.', // private
];

const PRIVATE_IPV6_PREFIXES: readonly string[] = [
  '::1', // loopback
  'fc', // unique local
  'fd', // unique local
  'fe8', // link-local
  'fe9',
  'fea',
  'feb',
];

/** 172.16.0.0/12 is a range, not a single prefix. */
function isPrivateIpv4(hostname: string): boolean {
  if (PRIVATE_IPV4_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
    return true;
  }

  const match = /^172\.(\d{1,3})\./.exec(hostname);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }

  // 100.64.0.0/10 carrier-grade NAT
  const cgnat = /^100\.(\d{1,3})\./.exec(hostname);
  if (cgnat) {
    const second = Number(cgnat[1]);
    if (second >= 64 && second <= 127) return true;
  }

  return false;
}

/** Dotted-quad check, so a hostname like `10.example.com` is not treated as an IP. */
function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Convert an IPv4-mapped IPv6 tail (`7f00:1`) to dotted quad (`127.0.0.1`). */
function hexTailToIpv4(tail: string): string | null {
  const parts = tail.split(':');
  if (parts.length !== 2) return null;

  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (Number.isNaN(high) || Number.isNaN(low)) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  // IPv4-mapped IPv6: `::ffff:127.0.0.1`, normalized by URL to `::ffff:7f00:1`.
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped) {
    const tail = mapped[1];
    const dotted = isIpv4Literal(tail) ? tail : hexTailToIpv4(tail);
    return dotted !== null && isPrivateIpv4(dotted);
  }

  if (host.includes(':')) {
    return PRIVATE_IPV6_PREFIXES.some((prefix) => host.startsWith(prefix));
  }

  return isIpv4Literal(host) && isPrivateIpv4(host);
}

/**
 * Validate a webhook URL and return the normalized string to POST to.
 *
 * Returning the checked value (rather than letting the caller re-read the raw
 * property) keeps the request on the URL that was actually validated.
 */
export function assertWebhookTarget(
  rawUrl: string,
  policy: WebhookTargetPolicy = {}
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL must be an absolute http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Webhook URL scheme must be http or https, got ${parsed.protocol}`);
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Webhook URL must not contain embedded credentials');
  }

  if (parsed.hostname === '') {
    throw new Error('Webhook URL must name a host');
  }

  if (!policy.allowPrivateHosts && isPrivateHostname(parsed.hostname)) {
    throw new Error(
      `Refusing webhook to private or loopback address: ${parsed.hostname}`
    );
  }

  return parsed.toString();
}
