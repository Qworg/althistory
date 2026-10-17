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
 * are real subnets rather than string prefixes: `::`, `::1`, `fc00::/7`,
 * `fe80::/10`, IPv4-mapped IPv6 (`::ffff:0:0/96`) and NAT64 (`64:ff9b::/96`)
 * are covered, and a hostname such as `10.example.com` is not mistaken for an
 * address.
 *
 * Only literal addresses are checked. A hostname that resolves to a private
 * address is not caught here (that needs a resolver, and DNS can change between
 * check and connect); deployments that need that guarantee should route egress
 * through a network policy. Redirects are handled by the caller: `JobService`
 * posts with `redirect: 'manual'` so a 3xx cannot re-send the body to an
 * unvalidated destination.
 */

import { BlockList, isIP } from 'net';
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
PRIVATE_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('::', 128, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('::1', 128, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('64:ff9b::', 96, 'ipv6');

/** Lowercase, strip the IPv6 brackets and any trailing root-label dot. */
function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
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
