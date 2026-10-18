import { describe, it, expect } from 'vitest';
import { assertWebhookTarget } from './webhookTarget';

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
