/**
 * `autoAttach` decides whether the token rides along.
 *
 * The option is documented as "Include auth token in all requests". It was
 * stored on construction and then read by nothing, so a caller who turned it
 * off still had the token attached to every request — including, potentially,
 * requests to a backend they had deliberately excluded.
 *
 * Every attach site goes through `getAuthHeaders()`: the HTTP client, the
 * WebSocket client, and the re-apply after a refresh in the auth error
 * middleware. That makes it the one place the setting can be honoured.
 */

import { describe, it, expect } from 'vitest';

import { AuthenticationClient } from '../../../src/auth/client.js';
import { MemoryTokenStorage } from '../../../src/auth/storage.js';
import type { AuthContext } from '../../../src/auth/types.js';

function context(): AuthContext {
  return {
    userId: 'u1',
    roles: ['user'],
    permissions: ['read'],
    token: { type: 'bearer', expiresAt: new Date(Date.now() + 3_600_000) },
  } as AuthContext;
}

function clientWithToken(options: { autoAttach?: boolean } = {}): AuthenticationClient {
  const client = new AuthenticationClient({ storage: new MemoryTokenStorage(), ...options });
  client.setToken('the-token', context());
  return client;
}

describe('AuthenticationClient.getAuthHeaders — autoAttach', () => {
  it('attaches the token by default', () => {
    expect(clientWithToken().getAuthHeaders()).toEqual({ Authorization: 'Bearer the-token' });
  });

  it('attaches nothing when auto-attach is off', () => {
    expect(clientWithToken({ autoAttach: false }).getAuthHeaders()).toEqual({});
  });

  it('still attaches when auto-attach is explicitly on', () => {
    expect(clientWithToken({ autoAttach: true }).getAuthHeaders()).toEqual({
      Authorization: 'Bearer the-token',
    });
  });
});
