/**
 * NB-7: the AuthenticationClient must read the bearer token from the CANONICAL
 * signin/refresh envelope field `accessToken` (the same envelope whose
 * `refreshToken` it already reads), not the `metadata.token` field the server
 * never sends. Previously the access token was never stored, so neither the
 * Authorization header nor auto-refresh ever engaged. Cookie mode sends neither
 * field (tokens are HttpOnly cookies), which must leave `getToken()` undefined
 * so the client relies on cookies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthenticationClient } from '../../../src/auth/client.js';
import { MemoryTokenStorage } from '../../../src/auth/storage.js';
import type { AuthContext, AuthResult } from '../../../src/auth/types.js';

describe('AuthenticationClient token extraction (NB-7)', () => {
  let storage: MemoryTokenStorage;
  let client: AuthenticationClient;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
    client = new AuthenticationClient({ storage, autoRefresh: false });
  });

  const bearerContext = (): AuthContext =>
    ({
      userId: 'u1',
      roles: ['user'],
      permissions: [],
      token: { type: 'bearer', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    }) as unknown as AuthContext;

  it('extracts the bearer token from the canonical `accessToken` envelope field', () => {
    const result: AuthResult = {
      success: true,
      context: bearerContext(),
      metadata: { accessToken: 'AT-123', refreshToken: 'RT-456' },
    };

    client.setAuth(result);

    expect(client.getToken()).toBe('AT-123');
    expect(client.getRefreshToken()).toBe('RT-456');
    expect(storage.getToken()).toBe('AT-123');
  });

  it('falls back to the legacy `metadata.token` field for back-compat', () => {
    client.setAuth({
      success: true,
      context: bearerContext(),
      metadata: { token: 'legacy-token' },
    });

    expect(client.getToken()).toBe('legacy-token');
  });

  it('stores no bearer token in cookie mode (server sends neither field)', () => {
    client.setAuth({
      success: true,
      // Cookie mode: no bearer token in the context, none in the body.
      context: { userId: 'u1', roles: ['user'], permissions: [] } as unknown as AuthContext,
      metadata: {},
    });

    expect(client.isAuthenticated()).toBe(true);
    expect(client.getToken()).toBeUndefined();
  });
});
