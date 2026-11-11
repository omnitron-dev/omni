import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthenticationClient } from '../../../src/auth/client.js';
import { MemoryTokenStorage } from '../../../src/auth/storage.js';

const MAX_TIMEOUT = 2_147_483_647;
let client: AuthenticationClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => {
  client?.destroy();
  vi.useRealTimers();
});

function authenticate(expiresAt?: Date): void {
  client.setAuth({
    success: true,
    context: { userId: 'test-user', roles: ['user'], permissions: [], token: { type: 'bearer', expiresAt } },
    metadata: { token: 'test-token' },
  });
}

it('refreshes a long-lived token only at its actual refresh deadline', async () => {
  client = new AuthenticationClient({
    storage: new MemoryTokenStorage(), crossTabSync: { enabled: false },
    refreshThreshold: 30_000, inactivityConfig: { timeout: 0 },
  });
  const refreshed = vi.fn();
  client.on('token-refreshed', refreshed);
  authenticate(new Date(Date.now() + MAX_TIMEOUT + 60_000));

  await vi.advanceTimersByTimeAsync(MAX_TIMEOUT);
  expect(refreshed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(refreshed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(refreshed).toHaveBeenCalledExactlyOnceWith({ needsRefresh: true });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['clearAuth', 'destroy'] as const)('cancels a rearmed long-lived refresh on %s', async action => {
  client = new AuthenticationClient({
    storage: new MemoryTokenStorage(), crossTabSync: { enabled: false },
    refreshThreshold: 0, inactivityConfig: { timeout: 0 },
  });
  const refreshed = vi.fn();
  client.on('token-refreshed', refreshed);
  authenticate(new Date(Date.now() + MAX_TIMEOUT + 60_000));
  await vi.advanceTimersByTimeAsync(MAX_TIMEOUT);
  client[action]();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refreshed).not.toHaveBeenCalled();
});

it.each(['setAuth', 'setToken'] as const)('cancels the old expiry when %s replaces credentials without one', async action => {
  client = new AuthenticationClient({
    storage: new MemoryTokenStorage(), crossTabSync: { enabled: false },
    refreshThreshold: 0, inactivityConfig: { timeout: 0 },
  });
  const refreshed = vi.fn();
  client.on('token-refreshed', refreshed);
  authenticate(new Date(Date.now() + 10_000));
  if (action === 'setAuth') authenticate();
  else client.setToken('replacement-token');
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refreshed).not.toHaveBeenCalled();
});

it('honors a long inactivity timeout and resets its deadline on activity', async () => {
  const inactive = vi.fn();
  client = new AuthenticationClient({
    storage: new MemoryTokenStorage(), crossTabSync: { enabled: false }, autoRefresh: false,
    inactivityConfig: { timeout: MAX_TIMEOUT + 60_000, events: ['click'], onInactivity: inactive },
  });
  authenticate();
  await vi.advanceTimersByTimeAsync(MAX_TIMEOUT);
  expect(inactive).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('click'));
  await vi.advanceTimersByTimeAsync(MAX_TIMEOUT);
  expect(inactive).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(inactive).toHaveBeenCalledOnce();
});
