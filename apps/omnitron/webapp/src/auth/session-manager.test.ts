/**
 * Deciding whether the console's token is still good.
 *
 * This is the check that keeps a signed-in operator signed in. When it says
 * "fresh" about a token that is not, every RPC comes back 401 and the console
 * renders a platform that appears to be gone — "Applications 0 / No apps
 * yet", status bar Offline. That exact state has happened here twice, from
 * two different causes, and both are recorded in the comments of this file's
 * subject.
 *
 * The module reads `sessionStorage` directly, so these tests supply one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'omnitron_token';
const store = new Map<string, string>();

/** A JWT whose payload says it expires `secondsFromNow` from now. */
function tokenExpiringIn(secondsFromNow: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + secondsFromNow, sid: 'sess-1' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${b64}.signature`;
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));
  vi.resetModules();
});

/** Fresh module instance, so the singleton's state does not leak between tests. */
async function manager() {
  const mod = await import('./session-manager.js');
  return mod.sessionManager;
}

describe('isAccessTokenStale', () => {
  it('says stale when there is no token at all', async () => {
    // The safe answer: no token cannot be fresh, and treating "unknown" as
    // "fine" is what leaves a console making calls it cannot authenticate.
    expect((await manager()).isAccessTokenStale()).toBe(true);
  });

  it('says stale for a token that is not a JWT', async () => {
    store.set(KEY, 'not-a-jwt');
    expect((await manager()).isAccessTokenStale()).toBe(true);
  });

  it('says stale for a JWT whose payload will not parse', async () => {
    store.set(KEY, 'header.!!!not-base64!!!.sig');
    expect((await manager()).isAccessTokenStale()).toBe(true);
  });

  it('says stale for a JWT with no exp claim', async () => {
    const b64 = Buffer.from(JSON.stringify({ sid: 'sess-1' })).toString('base64url');
    store.set(KEY, `header.${b64}.sig`);
    expect((await manager()).isAccessTokenStale()).toBe(true);
  });

  it('says fresh for a token with time left', async () => {
    store.set(KEY, tokenExpiringIn(3600));
    expect((await manager()).isAccessTokenStale()).toBe(false);
  });

  it('says stale inside the refresh window, before expiry', async () => {
    // The point of the threshold: refresh at 30s remaining, not at 0. A
    // token that expires during the request it is authenticating is already
    // too late.
    store.set(KEY, tokenExpiringIn(10));
    expect((await manager()).isAccessTokenStale()).toBe(true);
  });

  it('says stale for an already-expired token', async () => {
    store.set(KEY, tokenExpiringIn(-60));
    expect((await manager()).isAccessTokenStale()).toBe(true);
  });
});

describe('refresh', () => {
  it('refuses when there is no session to refresh', async () => {
    // No token means no session id to send, and reporting success here would
    // tell the caller a dead session is alive.
    expect(await (await manager()).refresh()).toBe(false);
  });
});
