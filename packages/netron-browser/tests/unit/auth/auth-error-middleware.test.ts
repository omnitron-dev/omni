/**
 * NB-6: the REAL `createAuthErrorMiddleware` 401 path must actually refresh the
 * token and SIGNAL a re-invoke (consumed by http-client.invoke). The old code
 * never called `authClient.refreshToken()` (it returned false exactly when a
 * refresh was needed) and only set an `auth:retry` flag that nothing consumed,
 * so a 401 could never recover.
 *
 * (The sibling auth-error-handler.test.ts exercises a DIFFERENT, test-local mock
 * class — not this middleware — so it doesn't cover this behaviour.)
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthErrorMiddleware } from '../../../src/middleware/built-in/auth-error-handler.js';
import type { ClientMiddlewareContext } from '../../../src/middleware/types.js';

function makeCtx(): ClientMiddlewareContext {
  return {
    service: 'svc',
    method: 'm',
    args: [],
    request: { headers: {} as Record<string, string> },
    metadata: new Map(),
    timing: { start: 0, middlewareTimes: new Map() },
    transport: 'http',
  } as unknown as ClientMiddlewareContext;
}

function makeAuthClient(overrides: Record<string, unknown> = {}) {
  return {
    refreshToken: vi.fn(async () => ({ success: true })),
    clearAuth: vi.fn(),
    getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer NEW' })),
    getContext: vi.fn(() => ({ userId: 'u1' })),
    needsRefresh: vi.fn(() => true),
    emit: vi.fn(),
    ...overrides,
  } as any;
}

const err401 = () => Object.assign(new Error('Unauthorized'), { code: 401 });

describe('createAuthErrorMiddleware — 401 refresh + retry (NB-6)', () => {
  it('performs a REAL token refresh and signals a re-invoke on 401', async () => {
    const authClient = makeAuthClient();
    const mw = createAuthErrorMiddleware({ authClient });
    const ctx = makeCtx();

    await mw(ctx, async () => {
      throw err401();
    });

    expect(authClient.refreshToken).toHaveBeenCalledTimes(1); // actually refreshes
    expect(ctx.metadata.get('auth:retry')).toBe(true); // re-invoke signal for http-client
    expect((ctx.request as any).headers.Authorization).toBe('Bearer NEW'); // refreshed header applied
  });

  it('clears auth and fires onSessionExpired when the refresh fails', async () => {
    const authClient = makeAuthClient({
      refreshToken: vi.fn(async () => ({ success: false, error: 'expired' })),
    });
    const onSessionExpired = vi.fn();
    const mw = createAuthErrorMiddleware({ authClient, onSessionExpired });
    const ctx = makeCtx();

    await expect(
      mw(ctx, async () => {
        throw err401();
      })
    ).rejects.toThrow('Unauthorized');

    expect(authClient.clearAuth).toHaveBeenCalled();
    expect(onSessionExpired).toHaveBeenCalled();
    expect(ctx.metadata.get('auth:retry')).toBeUndefined(); // no retry signalled on failure
  });

  it('does NOT refresh on a non-auth error and re-throws it', async () => {
    const authClient = makeAuthClient();
    const mw = createAuthErrorMiddleware({ authClient });
    const ctx = makeCtx();

    await expect(
      mw(ctx, async () => {
        throw Object.assign(new Error('boom'), { code: 500 });
      })
    ).rejects.toThrow('boom');

    expect(authClient.refreshToken).not.toHaveBeenCalled();
  });
});
