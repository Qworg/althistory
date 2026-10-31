import { describe, it, expect, vi } from 'vitest';
import { assertWebhookTarget, assertWebhookTargetResolved } from './webhookTarget';
import { ValidationError } from './errors';

describe('assertWebhookTarget', () => {
  it('accepts and normalizes a public https URL', () => {
    expect(assertWebhookTarget('https://example.com/hooks/job')).toBe(
      'https://example.com/hooks/job'
    );
  });

  it('accepts http webhooks', () => {
    expect(assertWebhookTarget('http://example.com/hook')).toBe('http://example.com/hook');
  });

  it('rejects a relative or unparseable URL', () => {
    expect(() => assertWebhookTarget('/hooks/job')).toThrow('absolute http(s) URL');
    expect(() => assertWebhookTarget('not a url')).toThrow('absolute http(s) URL');
  });

  it('rejects non-http schemes', () => {
    expect(() => assertWebhookTarget('ftp://example.com/hook')).toThrow(
      'scheme must be http or https'
    );
    expect(() => assertWebhookTarget('file:///etc/passwd')).toThrow(
      'scheme must be http or https'
    );
  });

  it('rejects embedded credentials', () => {
    expect(() => assertWebhookTarget('https://user:pass@example.com/hook')).toThrow(
      'must not contain embedded credentials'
    );
  });

  it.each([
    'http://localhost/hook',
    'http://app.localhost/hook',
    'http://127.0.0.1/hook',
    'http://127.10.1.2/hook',
    'http://10.0.0.5/hook',
    'http://172.16.0.1/hook',
    'http://172.31.255.255/hook',
    'http://192.168.1.10/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/hook',
    'http://100.64.0.1/hook',
    'http://[::1]/hook',
    'http://[::]/hook',
    'http://[fd00::1]/hook',
    'http://[fe80::1]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    'http://localhost./hook',
    'http://localhost.../hook',
    'http://[64:ff9b::a9fe:a9fe]/hook',
    'http://[64:ff9b:1::1]/hook',
    'http://192.0.0.1/hook',
    'http://198.18.0.1/hook',
    'http://240.0.0.1/hook',
    'http://[fec0::1]/hook',
    'http://[::127.0.0.1]/hook',
  ])('rejects the private or loopback destination %s', (url) => {
    expect(() => assertWebhookTarget(url)).toThrow('private or loopback');
  });

  it('permits a private destination only when the policy allows it', () => {
    expect(assertWebhookTarget('http://localhost:9000/hook', { allowPrivateHosts: true })).toBe(
      'http://localhost:9000/hook'
    );
  });

  it('matches address ranges rather than string prefixes', () => {
    // A documentation-range address is a valid literal target; it only looks
    // unusual, so nothing about the prefix rules may reject it.
    expect(assertWebhookTarget('http://[2001:db8::1]/hook')).toBe('http://[2001:db8::1]/hook');
    // `::1:2` is the deprecated IPv4-compatible form of 0.0.1.2, so it is
    // rejected for being in 0.0.0.0/8, not for starting with "::1".
    expect(() => assertWebhookTarget('http://[::1:2]/hook')).toThrow('private or loopback');
  });

  it('does not mistake a public address that merely starts like a private one', () => {
    expect(assertWebhookTarget('https://172.15.0.1/hook')).toBe('https://172.15.0.1/hook');
    expect(assertWebhookTarget('https://172.32.0.1/hook')).toBe('https://172.32.0.1/hook');
    expect(assertWebhookTarget('https://100.128.0.1/hook')).toBe('https://100.128.0.1/hook');
    expect(assertWebhookTarget('https://10.example.com/hook')).toBe('https://10.example.com/hook');
  });
});

describe('assertWebhookTargetResolved', () => {
  const resolvesTo = (...addresses: string[]) => vi.fn(async () => addresses);

  it('accepts a name that resolves only to public addresses', async () => {
    await expect(
      assertWebhookTargetResolved('https://hooks.example.com/x', resolvesTo('93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'))
    ).resolves.toBe('https://hooks.example.com/x');
  });

  it.each([
    ['the loopback', '127.0.0.1'],
    ['the cloud metadata address', '169.254.169.254'],
    ['a private network', '10.1.2.3'],
    ['the IPv6 loopback', '::1'],
    ['an IPv4-mapped address', '::ffff:127.0.0.1'],
  ])('refuses a name that resolves to %s', async (_label, address) => {
    const error = await assertWebhookTargetResolved(
      'https://127.0.0.1.nip.io/x',
      resolvesTo('93.184.215.14', address)
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain(address);
  });

  it('reports a name that does not resolve as a plain error, so it can be retried', async () => {
    const error = await assertWebhookTargetResolved(
      'https://missing.example/x',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      })
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ValidationError);
  });

  it('does not resolve a literal address, which the URL check already covers', async () => {
    const resolver = resolvesTo('127.0.0.1');

    await expect(assertWebhookTargetResolved('https://93.184.215.14/x', resolver)).resolves.toBe(
      'https://93.184.215.14/x'
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('still refuses a private literal before resolving anything', async () => {
    await expect(assertWebhookTargetResolved('http://127.0.0.1:9000/x', resolvesTo())).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});
