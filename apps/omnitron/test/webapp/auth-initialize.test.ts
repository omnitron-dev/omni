/**
 * Restoring a session on load, once.
 *
 * Both route guards call `initialize()` from a mount effect, and `StrictMode`
 * runs that effect twice. The `initialized` flag cannot stop the second call
 * because it is set at the END of the flow, several awaits in — so the flag
 * guards a second call only when there is no second CALLER.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const validateSession = vi.fn();
const sessionManager = {
  isAccessTokenStale: vi.fn(() => false),
  refresh: vi.fn(async () => false),
  start: vi.fn(),
  stop: vi.fn(),
};

// The store imports through the console's `src/` alias, so the mock has to
// name the same specifier the module does.
const clearSession = vi.fn();

vi.mock('src/netron/client', () => ({
  getSessionId: () => 'sess-1',
  setStorageToken: vi.fn(),
  clearSession: (...args: unknown[]) => clearSession(...args),
  authRpc: (method: string, params: unknown) => {
    if (method === 'validateSession') return validateSession(params);
    throw new Error(`unexpected rpc: ${method}`);
  },
}));

vi.mock('src/utils/errors', () => ({
  sanitizeReturnTo: (v: string) => v,
}));

vi.mock('../../webapp/src/auth/session-manager', () => ({ sessionManager }));

async function freshStore() {
  vi.resetModules();
  validateSession.mockReset();
  clearSession.mockReset();
  sessionManager.start.mockReset();
  sessionManager.isAccessTokenStale.mockReturnValue(false);
  const mod = await import('../../webapp/src/auth/store.js');
  return mod.useAuthStore;
}

beforeEach(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
    writable: true,
  });
});

const validUser = {
  valid: true,
  user: { id: 'u1', username: 'admin', displayName: 'Admin', role: 'admin' },
  session: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
};

describe('auth initialize', () => {
  it('validates the session once for two concurrent callers', async () => {
    // Two guards, or one guard mounted twice by StrictMode. Before the
    // in-flight guard this issued two round trips whose only difference was
    // which finished second.
    const store = await freshStore();
    let release!: (v: unknown) => void;
    validateSession.mockImplementation(() => new Promise((r) => { release = r; }));

    const a = store.getState().initialize();
    const b = store.getState().initialize();

    expect(validateSession).toHaveBeenCalledTimes(1);

    release(validUser);
    await Promise.all([a, b]);

    expect(store.getState().user?.username).toBe('admin');
    expect(store.getState().initialized).toBe(true);
    // `start()` is idempotent, but calling it twice would still restart the
    // refresh schedule under the first caller.
    expect(sessionManager.start).toHaveBeenCalledTimes(1);
  });

  it('does not validate again once initialised', async () => {
    const store = await freshStore();
    validateSession.mockResolvedValue(validUser);

    await store.getState().initialize();
    await store.getState().initialize();

    expect(validateSession).toHaveBeenCalledTimes(1);
  });

  it('marks itself initialised even when validation fails', async () => {
    // That is what lets the guard redirect to sign-in instead of showing a
    // spinner forever.
    const store = await freshStore();
    validateSession.mockRejectedValueOnce(new Error('daemon unreachable'));

    await store.getState().initialize();

    expect(store.getState().initialized).toBe(true);
    expect(store.getState().user).toBeNull();
    expect(validateSession).toHaveBeenCalledTimes(1);
  });

  it('can try again after a run that threw', async () => {
    // The in-flight promise has to be released however the run ends. It can
    // end by THROWING: the failure path calls `clearSession()`, which reaches
    // `clearAuth()` in netron-browser and from there `clearStorage()` and a
    // BroadcastChannel — both of which throw in a browser that blocks site
    // data. Hold a rejected promise in `initializing` and every later call
    // returns that same rejection: the console can never initialise again,
    // and the first cause is long gone.
    const store = await freshStore();
    validateSession.mockRejectedValueOnce(new Error('daemon unreachable'));
    clearSession.mockImplementationOnce(() => {
      throw new Error('SecurityError: The operation is insecure.');
    });

    await expect(store.getState().initialize()).rejects.toThrow('SecurityError');
    expect(store.getState().initialized).toBe(false);

    validateSession.mockResolvedValue(validUser);
    await store.getState().initialize();

    expect(store.getState().user?.username).toBe('admin');
    expect(validateSession).toHaveBeenCalledTimes(2);
  });
});
