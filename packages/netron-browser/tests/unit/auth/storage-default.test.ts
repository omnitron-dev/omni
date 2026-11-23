/**
 * NB-3 regression — the auth client must NOT persist tokens to localStorage by
 * default. Previously the default was LocalTokenStorage, which wrote the access
 * token AND the long-lived refresh token (under `<key>_context`) to localStorage,
 * readable by any same-origin XSS. The secure default is now MemoryTokenStorage;
 * persistence is opt-in via `storage`/`storageKey`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthenticationClient } from '../../../src/auth/client.js';
import { LocalTokenStorage } from '../../../src/auth/storage.js';

const CONTEXT_KEY = 'netron_auth_token_context';

describe('AuthenticationClient storage default (NB-3)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('does NOT write tokens to localStorage by default', () => {
    const client = new AuthenticationClient();
    client.setRefreshToken('super-secret-refresh');

    if (typeof localStorage !== 'undefined') {
      // The default MemoryTokenStorage keeps state in memory only.
      expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
      // And the secret must not appear anywhere in localStorage.
      let dump = '';
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) dump += localStorage.getItem(k) ?? '';
      }
      expect(dump).not.toContain('super-secret-refresh');
    }
  });

  it('persists only when the app explicitly opts into LocalTokenStorage', () => {
    const client = new AuthenticationClient({ storage: new LocalTokenStorage('netron_auth_token') });
    client.setRefreshToken('opt-in-refresh');

    if (typeof localStorage !== 'undefined') {
      const ctx = localStorage.getItem(CONTEXT_KEY);
      expect(ctx).toBeTruthy();
      expect(ctx).toContain('opt-in-refresh');
    }
  });

  it('keeps the default in-memory session local to each client', () => {
    const first = new AuthenticationClient();
    const second = new AuthenticationClient();
    try {
      first.setToken('first-session');
      second.setToken('second-session');
      expect(first.getToken()).toBe('first-session');
      expect(second.getToken()).toBe('second-session');
      const fresh = new AuthenticationClient();
      try { expect(fresh.isAuthenticated()).toBe(false); }
      finally { fresh.destroy(); }
    } finally {
      first.destroy();
      second.destroy();
    }
  });
});
