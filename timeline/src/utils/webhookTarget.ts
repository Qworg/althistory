/**
 * Validation for caller-supplied webhook targets.
 *
 * A job's `webhookUrl` comes from the API request body, so posting to it is an
 * outbound request driven by caller input (CWE-918). The rules here are a
 * deliberate default rather than an exhaustive SSRF defence:
 *
 *   - scheme allowlist: `http:` or `https:` only
 *   - no embedded credentials (`https://user:pass@host`)
 *   - no loopback/private/link-local/unspecified destination, so a webhook
 *     cannot be aimed at the process's own admin surface or the cloud metadata
 *     endpoint
 *
 * Addresses are matched with `net.BlockList` over the parsed IP, so the ranges
 * are real subnets rather than string prefixes, and a hostname such as
 * `10.example.com` is not mistaken for an address. The list is the IANA
 * special-purpose blocks that matter for outbound requests: `0.0.0.0/8`,
 * `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`,
 * `192.168/16`, `198.18/15`, `240/4`, plus IPv6 `::/128`, `::1/128`,
 * deprecated IPv4-compatible `::/96`, `fc00::/7`, deprecated site-local
 * `fec0::/10`, `fe80::/10`, NAT64 `64:ff9b::/96` and local-use NAT64
 * `64:ff9b:1::/48`. IPv4-mapped IPv6 is rejected wholesale (see the subnet note
 * below).
 *
 * Not covered: multicast (`224/4`, `ff00::/8`) and transition ranges that embed
 * an IPv4 address (`2002::/16`, `2001::/32`). None of those is a TCP POST
 * destination reachable on a default-configured host, and an exhaustive list
 * would still not replace a network-level egress policy.
 *
 * `assertWebhookTarget` checks the URL as written, which is what the request
 * that creates a job can do. `assertWebhookTargetResolved`, used when the
 * webhook is sent, also resolves a hostname and refuses it when any address
 * it names is private, so `127.0.0.1.nip.io` or an attacker's own `A` record
 * cannot reach the loopback or the metadata endpoint. What neither closes is
 * DNS rebinding: `fetch` resolves the name again when it connects, so a name
 * that answers publicly for the check and privately for the connection gets
 * through. Deployments that need that guarantee should route egress through a
 * network policy. Redirects are handled by the caller: `JobService` posts with
 * `redirect: 'manual'` so a 3xx cannot re-send the body to an unvalidated
 * destination.
 */

import { BlockList, isIP } from 'net';
import { lookup } from 'dns/promises';
import { ValidationError } from './errors';

export interface WebhookTargetPolicy {
  /** Permit loopback/private/link-local destinations (default false). */
  allowPrivateHosts?: boolean;
}

/**
 * Address ranges a webhook may not target.
 *
 * IPv4-mapped IPv6 (`::ffff:0:0/96`) is rejected wholesale rather than mapped
 * back to IPv4: a mapped literal is an unusual way to name an address. It is
 * checked in code rather than as a BlockList subnet because a mapped IPv6
 * subnet also matches every IPv4 lookup, which would block all IPv4 targets.
 */
const PRIVATE_ADDRESSES = new BlockList();
PRIVATE_ADDRESSES.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
PRIVATE_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
PRIVATE_ADDRESSES.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved
PRIVATE_ADDRESSES.addSubnet('::', 128, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('::1', 128, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('::', 96, 'ipv6'); // IPv4-compatible (deprecated)
PRIVATE_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fec0::', 10, 'ipv6'); // deprecated site-local
PRIVATE_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('64:ff9b::', 96, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64

/** Lowercase, strip the IPv6 brackets and any trailing root-label dot. */
function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

function isPrivateHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  const family = isIP(host);
  if (family === 4) {
    return PRIVATE_ADDRESSES.check(host, 'ipv4');
  }
  if (family === 6) {
    if (host.startsWith('::ffff:')) {
      return true;
    }
    return PRIVATE_ADDRESSES.check(host, 'ipv6');
  }

  return false;
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
    throw new ValidationError('Webhook URL must be an absolute http(s) URL', 'webhook', rawUrl);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(
      `Webhook URL scheme must be http or https, got ${parsed.protocol}`,
      'webhook',
      rawUrl
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError(
      'Webhook URL must not contain embedded credentials',
      'webhook',
      rawUrl
    );
  }

  if (parsed.hostname === '') {
    throw new ValidationError('Webhook URL must name a host', 'webhook', rawUrl);
  }

  if (!policy.allowPrivateHosts && isPrivateHostname(parsed.hostname)) {
    throw new ValidationError(
      `Refusing webhook to private or loopback address: ${parsed.hostname}`,
      'webhook',
      rawUrl
    );
  }

  return parsed.toString();
}

/** Turns a hostname into the addresses it names. Injected by tests. */
export type WebhookResolver = (host: string) => Promise<string[]>;

const defaultResolver: WebhookResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((record) => record.address);

/** How long a webhook hostname may take to resolve. */
const RESOLVE_TIMEOUT_MS = 5000;

/**
 * {@link assertWebhookTarget}, plus the addresses a hostname resolves to.
 *
 * A private destination throws a `ValidationError`, which no retry can fix. A
 * name that cannot be resolved throws a plain `Error`, since DNS failures are
 * often transient.
 */
export async function assertWebhookTargetResolved(
  rawUrl: string,
  resolver: WebhookResolver = defaultResolver,
  policy: WebhookTargetPolicy = {}
): Promise<string> {
  const endpoint = assertWebhookTarget(rawUrl, policy);
  const host = normalizeHostname(new URL(endpoint).hostname);
  if (policy.allowPrivateHosts || isIP(host) !== 0) {
    // A literal address was checked above.
    return endpoint;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: string[];
  try {
    addresses = await Promise.race([
      resolver(host),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`The DNS lookup did not answer within ${RESOLVE_TIMEOUT_MS} ms`)),
          RESOLVE_TIMEOUT_MS
        );
      }),
    ]);
  } catch (error) {
    throw new Error(
      `Could not resolve webhook host ${host}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (addresses.length === 0) {
    throw new Error(`Could not resolve webhook host ${host}: it names no address`);
  }

  for (const address of addresses) {
    // A resolver answers with addresses; anything else is refused as well.
    if (isIP(normalizeHostname(address)) === 0 || isPrivateHostname(address)) {
      throw new ValidationError(
        `Refusing webhook to ${host}: it resolves to the private or loopback address ${address}`,
        'webhook',
        rawUrl
      );
    }
  }

  return endpoint;
}
