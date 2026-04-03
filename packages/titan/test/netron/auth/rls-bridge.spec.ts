import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @kysera/rls before import
const mockRunAsync = vi.fn();
const mockGetContextOrNull = vi.fn();

vi.mock('@kysera/rls', () => ({
  rlsContext: {
    runAsync: mockRunAsync,
    getContextOrNull: mockGetContextOrNull,
  },
}));

// Dynamic import after mocking
const { mapAuthToRLSAuthContext, mapAuthToRLSContext, withAuthRLSContext, withSystemRLSContext } =
  await import('../../../src/netron/auth/rls-bridge.js');

describe('RLS Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAsync.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());
  });

  describe('mapAuthToRLSAuthContext', () => {
    it('should map AuthContext to RLSAuthContext', () => {
      const auth = {
        userId: 'user-1',
        roles: ['admin', 'user'],
        permissions: ['read', 'write'],
        scopes: ['openid', 'profile'],
        metadata: { key: 'value' },
      };

      const result = mapAuthToRLSAuthContext(auth);

      expect(result.userId).toBe('user-1');
      expect(result.roles).toEqual(['admin', 'user']);
      expect(result.permissions).toEqual(['read', 'write']);
      expect(result.attributes).toEqual({ key: 'value' });
      expect(result.isSystem).toBe(false);
    });

    it('should use defaultTenantId from options', () => {
      const auth = {
        userId: 'user-1',
        roles: [],
        permissions: [],
      };

      const result = mapAuthToRLSAuthContext(auth, { defaultTenantId: 'tenant-42' });

      expect(result.tenantId).toBe('tenant-42');
    });

    it('should handle missing optional fields', () => {
      const auth = {
        userId: 'user-1',
        roles: [],
        permissions: [],
      };

      const result = mapAuthToRLSAuthContext(auth);

      expect(result.scopes).toBeUndefined();
      expect(result.claims).toBeUndefined();
      expect(result.tenantId).toBeUndefined();
    });
  });

  describe('mapAuthToRLSContext', () => {
    it('should create full RLSContext with timestamp', () => {
      const auth = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const result = mapAuthToRLSContext(auth);

      expect(result.auth).toBeDefined();
      expect(result.auth.userId).toBe('user-1');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('withAuthRLSContext', () => {
    it('should run function within RLS context', async () => {
      const auth = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const fn = vi.fn().mockResolvedValue('result');

      await withAuthRLSContext(auth, fn);

      expect(mockRunAsync).toHaveBeenCalledTimes(1);
      const ctx = mockRunAsync.mock.calls[0][0];
      expect(ctx.auth.userId).toBe('user-1');
      expect(fn).toHaveBeenCalled();
    });

    it('should pass options through', async () => {
      const auth = {
        userId: 'user-1',
        roles: [],
        permissions: [],
      };

      await withAuthRLSContext(auth, async () => 'ok', { defaultTenantId: 'tenant-1' });

      const ctx = mockRunAsync.mock.calls[0][0];
      expect(ctx.auth.tenantId).toBe('tenant-1');
    });
  });

  describe('withSystemRLSContext', () => {
    it('should run function with system context', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      await withSystemRLSContext(fn);

      expect(mockRunAsync).toHaveBeenCalledTimes(1);
      const ctx = mockRunAsync.mock.calls[0][0];
      expect(ctx.auth.isSystem).toBe(true);
      expect(ctx.auth.userId).toBe('system');
      expect(ctx.auth.roles).toContain('system');
    });

    it('should accept optional tenantId', async () => {
      await withSystemRLSContext(async () => 'ok', 'tenant-99');

      const ctx = mockRunAsync.mock.calls[0][0];
      expect(ctx.auth.tenantId).toBe('tenant-99');
    });
  });
});
