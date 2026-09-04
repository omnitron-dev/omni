/**
 * Request context — how a call arrived, as opposed to who made it.
 *
 * The address recorded against a session is shown to operators in the
 * sessions list, so it has to be something the server established, not
 * something the caller asserted. These tests pin that distinction: a
 * forwarded header is believed only when the operator has declared a proxy.
 */

import { describe, it, expect } from 'vitest';

import { createAuthContextWrapper, getRequestContext, getCurrentAuth } from '../../src/services/auth-context.js';

/** Run `fn` through the wrapper with the given transport metadata. */
async function withMetadata<T>(entries: Record<string, unknown>, fn: () => T, trustProxy = false): Promise<T> {
  const wrapper = createAuthContextWrapper({ trustProxy });
  const metadata = new Map<string, unknown>(Object.entries(entries));
  return wrapper(metadata, async () => fn()) as Promise<T>;
}

describe('request context', () => {
  it('is null outside a request', () => {
    expect(getRequestContext()).toBeNull();
  });

  it('stays unknown when no proxy is declared, even with a forwarded header', async () => {
    // The fetch Request carries no peer address, so the only candidate is a
    // header — written by whoever is talking to us. Believing it here would
    // let a client choose the address recorded against its own session,
    // reopening the hole that removing `ipAddress` from the sign-in payload
    // closed. An honest blank beats a forgeable value.
    const ip = await withMetadata({ 'x-forwarded-for': '198.51.100.1' }, () => getRequestContext()?.ipAddress);
    expect(ip).toBeUndefined();
  });

  it('believes the forwarded header once a proxy is declared', async () => {
    const ip = await withMetadata(
      { 'x-forwarded-for': '198.51.100.1' },
      () => getRequestContext()?.ipAddress,
      true
    );
    expect(ip).toBe('198.51.100.1');
  });

  it('takes the original client from a proxy chain', async () => {
    const ip = await withMetadata(
      { 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' },
      () => getRequestContext()?.ipAddress,
      true
    );
    expect(ip).toBe('198.51.100.1');
  });

  it('falls back to X-Real-IP behind a declared proxy', async () => {
    const ip = await withMetadata({ 'x-real-ip': '198.51.100.9' }, () => getRequestContext()?.ipAddress, true);
    expect(ip).toBe('198.51.100.9');
  });

  it('accepts the adapter spelling that strips the x- prefix', async () => {
    const ip = await withMetadata({ 'forwarded-for': '198.51.100.2' }, () => getRequestContext()?.ipAddress, true);
    expect(ip).toBe('198.51.100.2');
  });

  it('reports undefined rather than guessing when the transport says nothing', async () => {
    const ip = await withMetadata({}, () => getRequestContext()?.ipAddress, true);
    expect(ip).toBeUndefined();
  });

  it('leaves auth context untouched when the request is anonymous', async () => {
    const auth = await withMetadata({ 'x-forwarded-for': '127.0.0.1' }, () => getCurrentAuth());
    expect(auth).toBeNull();
  });

  it('exposes both contexts together for an authenticated call', async () => {
    const authContext = { userId: 'u-1', roles: ['admin'] } as never;
    const result = await withMetadata(
      { authContext, 'x-forwarded-for': '203.0.113.7' },
      () => ({ userId: getCurrentAuth()?.userId, ip: getRequestContext()?.ipAddress }),
      true
    );

    expect(result).toEqual({ userId: 'u-1', ip: '203.0.113.7' });
  });
});
