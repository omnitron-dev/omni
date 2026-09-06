/**
 * Session restore when the daemon cannot answer, versus when the session is
 * genuinely gone.
 *
 * Measured live with the daemon's Postgres refused: the console sat on a bare
 * progress bar for 28 seconds — three RPCs at nine seconds each — then showed
 * a sign-in page that said nothing about why. Every one of those calls failed
 * with ECONNREFUSED, which no amount of re-authenticating fixes, and the
 * ladder ended in `clearSession()` — throwing away a session that was
 * probably still valid so the operator could re-authenticate against the
 * database that was down.
 *
 * The refresh-then-validate-then-refresh ladder exists for an expired token.
 * These tests pin which failures it runs for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authRpc = vi.fn();
const refresh = vi.fn();
const clearSession = vi.fn();
let storedSessionId: string | null = 'session-1';

vi.mock('../../webapp/src/auth/session-manager', () => ({
  sessionManager: {
    isAccessTokenStale: () => false,
    refresh: () => refresh(),
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('../../webapp/src/netron/client', () => ({
  getSessionId: () => storedSessionId,
  setStorageToken: vi.fn(),
  clearSession: () => clearSession(),
  authRpc: (method: string, params: unknown) => authRpc(method, params),
}));

async function freshStore() {
  vi.resetModules();
  const mod = await import('../../webapp/src/auth/store.js');
  return mod.useAuthStore;
}

const withCode = (message: string, code: unknown) => Object.assign(new Error(message), { code });

beforeEach(() => {
  authRpc.mockReset();
  refresh.mockReset();
  clearSession.mockReset();
  storedSessionId = 'session-1';
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
  });
});

describe('initialize', () => {
  it('does not retry, and does not sign the operator out, when the daemon cannot answer', async () => {
    authRpc.mockRejectedValue(withCode('An internal server error occurred', 'ECONNREFUSED'));
    const useAuthStore = await freshStore();

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.initError).toMatch(/database/i);
    // The ladder is for an expired token. Running it here costs three RPC
    // timeouts and ends in the same place.
    expect(refresh).not.toHaveBeenCalled();
    // And the session is left alone: it is very likely still valid, and the
    // daemon simply cannot say so.
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('still runs the ladder for an expired token', async () => {
    // The behaviour this replaces must survive for the case it was for.
    authRpc.mockRejectedValue(withCode('Token expired', 401));
    refresh.mockResolvedValue(false);
    const useAuthStore = await freshStore();

    await useAuthStore.getState().initialize();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalled();
    expect(useAuthStore.getState().initError).toBeNull();
  });

  it('treats an error with no code as an auth failure, as before', async () => {
    authRpc.mockRejectedValue(new Error('something'));
    refresh.mockResolvedValue(false);
    const useAuthStore = await freshStore();

    await useAuthStore.getState().initialize();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('says nothing when there is no session to restore', async () => {
    storedSessionId = null;
    const useAuthStore = await freshStore();

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().initialized).toBe(true);
    expect(useAuthStore.getState().initError).toBeNull();
    expect(authRpc).not.toHaveBeenCalled();
  });
});
