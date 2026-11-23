/**
 * NR-9: AuthProvider.login was a stub that ALWAYS threw 'Login not implemented'
 * while being public (re-exported via prism). It now delegates to a
 * consumer-supplied `onLogin` handler (the provider owns no Netron connection),
 * throwing a clear, actionable error only when unconfigured.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { AuthProvider, useAuth } from '../src/auth/context.js';
import { NetronReactClient } from '../src/core/client.js';

function makeMockClient() {
  return {
    isAuthenticated: () => false,
    getContext: () => undefined,
    getToken: () => null,
    getAuthHeaders: () => ({}),
    on: vi.fn(),
    off: vi.fn(),
    setAuth: vi.fn(),
    logout: vi.fn(async () => {}),
    refreshToken: vi.fn(async () => ({ success: true })),
  } as any;
}

describe('NR-9: AuthProvider.login', () => {
  it.each([undefined, 'memory', 'session', 'local'] as const)(
    'uses the selected storage across provider and transport clients (%s)',
    async (storage) => {
      localStorage.clear();
      sessionStorage.clear();
      const onLogin = async () => ({
        success: true,
        context: { userId: 'reader', roles: [], permissions: [] },
        metadata: { accessToken: 'test-token' },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider config={{ storage }} onLogin={onLogin}>{children}</AuthProvider>
      );
      const view = renderHook(() => useAuth(), { wrapper });
      try {
        await act(async () => { await view.result.current.login({}); });
        expect(view.result.current.token).toBe('test-token');
        expect(localStorage.getItem('netron_auth_token')).toBe(storage === 'local' ? 'test-token' : null);
        expect(sessionStorage.getItem('netron_auth_token')).toBe(storage === 'session' ? 'test-token' : null);
        const reader = new NetronReactClient({ url: 'http://localhost', auth: { storage } }).getAuth()!;
        try {
          expect(reader.getToken() ?? null).toBe(storage === 'session' || storage === 'local' ? 'test-token' : null);
        } finally {
          reader.destroy();
        }
      } finally {
        view.unmount();
        localStorage.clear();
        sessionStorage.clear();
      }
    },
  );

  it('throws a clear configuration error when no onLogin handler is provided', async () => {
    const client = makeMockClient();
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider client={client}>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await expect(result.current.login({} as any)).rejects.toThrow(/requires an `onLogin` handler/);
  });

  it('delegates to onLogin and calls setAuth on success', async () => {
    const client = makeMockClient();
    const authResult = { success: true, context: { userId: 'u1' } };
    const onLogin = vi.fn(async () => authResult as any);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider client={client} onLogin={onLogin}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    let res: any;
    await act(async () => {
      res = await result.current.login({ token: 'x' } as any);
    });
    expect(onLogin).toHaveBeenCalledWith({ token: 'x' });
    expect(client.setAuth).toHaveBeenCalledWith(authResult);
    expect(res).toEqual(authResult);
  });

  it('propagates an unsuccessful onLogin result as a thrown error (no setAuth)', async () => {
    const client = makeMockClient();
    const onLogin = vi.fn(async () => ({ success: false, error: 'bad creds' } as any));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider client={client} onLogin={onLogin}>
        {children}
      </AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await expect(result.current.login({} as any)).rejects.toThrow(/bad creds/);
    expect(client.setAuth).not.toHaveBeenCalled();
  });
});
