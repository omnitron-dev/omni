import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @kysera/rls before import
const mockGetContextOrNull = vi.fn();

vi.mock('@kysera/rls', () => ({
  rlsContext: {
    getContextOrNull: mockGetContextOrNull,
  },
}));

// Dynamic import after mocking
const {
  RequireRlsContext,
  RequireUser,
  RequireTenant,
  RequireRole,
  RequirePermission,
  RequireAdmin,
  RlsProtected,
  RlsGuardError,
  getRlsGuardRequirements,
} = await import('../../../src/netron/auth/decorators.js');

describe('Auth Guard Decorators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createDecoratedClass(decorator: MethodDecorator) {
    class TestService {
      async doWork(): Promise<string> {
        return 'done';
      }
    }

    const descriptor = Object.getOwnPropertyDescriptor(TestService.prototype, 'doWork')!;
    const result = decorator(TestService.prototype, 'doWork', descriptor);
    Object.defineProperty(TestService.prototype, 'doWork', result || descriptor);

    return new TestService();
  }

  describe('RlsGuardError', () => {
    it('should be an Error with correct name', () => {
      const error = new RlsGuardError('test');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('RlsGuardError');
      expect(error.message).toBe('test');
    });
  });

  describe('@RequireRlsContext', () => {
    it('should throw when no RLS context', async () => {
      mockGetContextOrNull.mockReturnValue(null);
      const svc = createDecoratedClass(RequireRlsContext());
      await expect(svc.doWork()).rejects.toThrow(RlsGuardError);
    });

    it('should pass when context exists', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], isSystem: false },
      });
      const svc = createDecoratedClass(RequireRlsContext());
      await expect(svc.doWork()).resolves.toBe('done');
    });

    it('should bypass checks for system users', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'system', roles: [], isSystem: true },
      });
      // Even with strict role requirement, system user passes
      const svc = createDecoratedClass(RequireRlsContext({ roles: ['admin'] }));
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('@RequireUser', () => {
    it('should require userId', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: '', roles: [], isSystem: false },
      });
      const svc = createDecoratedClass(RequireUser());
      await expect(svc.doWork()).rejects.toThrow('User authentication required');
    });

    it('should pass with userId', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], isSystem: false },
      });
      const svc = createDecoratedClass(RequireUser());
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('@RequireTenant', () => {
    it('should require tenantId', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], isSystem: false },
      });
      const svc = createDecoratedClass(RequireTenant());
      await expect(svc.doWork()).rejects.toThrow('Tenant context required');
    });

    it('should pass with tenantId', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], tenantId: 'tenant-1', isSystem: false },
      });
      const svc = createDecoratedClass(RequireTenant());
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('@RequireRole', () => {
    it('should require specific role', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: ['user'], isSystem: false },
      });
      const svc = createDecoratedClass(RequireRole('admin'));
      await expect(svc.doWork()).rejects.toThrow('Role required: admin');
    });

    it('should pass with matching role', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: ['admin', 'user'], isSystem: false },
      });
      const svc = createDecoratedClass(RequireRole('admin'));
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('@RequirePermission', () => {
    it('should require specific permission', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], permissions: ['read'], isSystem: false },
      });
      const svc = createDecoratedClass(RequirePermission('write'));
      await expect(svc.doWork()).rejects.toThrow('Permission required: write');
    });

    it('should pass with matching permission', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], permissions: ['read', 'write'], isSystem: false },
      });
      const svc = createDecoratedClass(RequirePermission('write'));
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('@RequireAdmin', () => {
    it('should require isSystem', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: ['admin'], isSystem: false },
      });
      const svc = createDecoratedClass(RequireAdmin());
      await expect(svc.doWork()).rejects.toThrow('Admin privileges required');
    });

    it('should pass for system user', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'system', roles: [], isSystem: true },
      });
      const svc = createDecoratedClass(RequireAdmin());
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('@RlsProtected', () => {
    it('should require any RLS context', async () => {
      mockGetContextOrNull.mockReturnValue(null);
      const svc = createDecoratedClass(RlsProtected());
      await expect(svc.doWork()).rejects.toThrow(RlsGuardError);
    });

    it('should pass with context', async () => {
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: [], isSystem: false },
      });
      const svc = createDecoratedClass(RlsProtected());
      await expect(svc.doWork()).resolves.toBe('done');
    });
  });

  describe('getRlsGuardRequirements', () => {
    it('should return metadata for decorated method', () => {
      class TestService {
        async doWork(): Promise<string> {
          return 'done';
        }
      }

      // Provide context so decorator doesn't throw
      mockGetContextOrNull.mockReturnValue({
        auth: { userId: 'user-1', roles: ['admin'], isSystem: false },
      });

      const decorator = RequireRlsContext({ roles: ['admin'], requireUser: true });
      const descriptor = Object.getOwnPropertyDescriptor(TestService.prototype, 'doWork')!;
      decorator(TestService.prototype, 'doWork', descriptor);

      const requirements = getRlsGuardRequirements(TestService.prototype, 'doWork');
      expect(requirements).toBeDefined();
      expect(requirements?.roles).toEqual(['admin']);
      expect(requirements?.requireUser).toBe(true);
    });
  });
});
