/**
 * Integration Tests for AuthenticationManager
 *
 * These tests use real implementations (except for logger) to validate
 * the full behavior of the AuthenticationManager including:
 * - Authentication with different handlers
 * - Token validation with caching
 * - Token refresh scenarios
 * - Timeout handling
 * - Cache invalidation
 * - Custom auth handlers via registerHandler pattern
 * - Concurrent authentication requests
 * - Cleanup via destroy pattern
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuditLogger, MemoryAuditAdapter } from '../../../src/netron/auth/audit-logger.js';
import type { AuthCredentials, AuthContext } from '../../../src/netron/auth/types.js';
import type { ILogger, LogLevel } from '../../../src/types/logger.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock logger implementing ILogger interface
 * Captures all log calls for verification
 */
function createMockLogger(): ILogger & {
  logs: { level: string; args: any[] }[];
  clearLogs: () => void;
} {
  const logs: { level: string; args: any[] }[] = [];

  const createLogMethod =
    (level: string) =>
    (...args: any[]) => {
      logs.push({ level, args });
    };

  const logger: any = {
    logs,
    clearLogs: () => {
      logs.length = 0;
    },
    trace: createLogMethod('trace'),
    debug: createLogMethod('debug'),
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
    fatal: createLogMethod('fatal'),
    child: () => logger,
    time: () => () => {},
    isLevelEnabled: () => true,
    setLevel: () => {},
    getLevel: () => 'debug' as LogLevel,
  };

  return logger;
}

/**
 * Simple in-memory user database for testing
 */
interface TestUser {
  userId: string;
  username: string;
  password: string;
  roles: string[];
  permissions: string[];
}

/**
 * Simple test authentication handler that implements credential validation
 * Uses an in-memory user database for testing
 */
class TestAuthHandler {
  private users: Map<string, TestUser> = new Map();
  private tokens: Map<string, { context: AuthContext; expiresAt: Date }> = new Map();
  private refreshTokens: Map<string, string> = new Map(); // refreshToken -> userId

  /**
   * Add a test user to the database
   */
  addUser(user: TestUser): void {
    this.users.set(user.username, user);
  }

  /**
   * Authenticate user with credentials
   */
  authenticate = async (credentials: AuthCredentials): Promise<AuthContext> => {
    // Handle token-based authentication
    if (credentials.token) {
      return this.validateToken(credentials.token);
    }

    // Handle username/password authentication
    const { username, password } = credentials;

    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const user = this.users.get(username);
    if (!user || user.password !== password) {
      throw new Error('Invalid credentials');
    }

    // Generate access token
    const now = Date.now();
    const token = 'token-' + user.userId + '-' + now;
    const refreshToken = 'refresh-' + user.userId + '-' + now;

    const context: AuthContext = {
      userId: user.userId,
      roles: user.roles,
      permissions: user.permissions,
      token: {
        type: 'bearer',
        expiresAt: new Date(now + 3600000), // 1 hour
      },
      metadata: {
        accessToken: token,
        refreshToken,
      },
    };

    // Store token for later validation
    this.tokens.set(token, {
      context,
      expiresAt: new Date(now + 3600000),
    });
    this.refreshTokens.set(refreshToken, user.userId);

    return context;
  };

  /**
   * Validate an access token
   */
  validateToken = async (token: string): Promise<AuthContext> => {
    const tokenData = this.tokens.get(token);

    if (!tokenData) {
      throw new Error('Invalid token');
    }

    if (tokenData.expiresAt < new Date()) {
      this.tokens.delete(token);
      throw new Error('Token expired');
    }

    return tokenData.context;
  };

  /**
   * Refresh an access token using a refresh token
   */
  refreshToken = async (refreshToken: string): Promise<AuthContext> => {
    const userId = this.refreshTokens.get(refreshToken);
    if (!userId) {
      throw new Error('Invalid refresh token');
    }

    // Find user by ID
    let user: TestUser | undefined;
    for (const u of this.users.values()) {
      if (u.userId === userId) {
        user = u;
        break;
      }
    }

    if (!user) {
      throw new Error('User not found');
    }

    // Generate new tokens
    const now = Date.now();
    const newToken = 'token-' + user.userId + '-' + now;
    const newRefreshToken = 'refresh-' + user.userId + '-' + now;

    const context: AuthContext = {
      userId: user.userId,
      roles: user.roles,
      permissions: user.permissions,
      token: {
        type: 'bearer',
        expiresAt: new Date(now + 3600000),
      },
      metadata: {
        accessToken: newToken,
        refreshToken: newRefreshToken,
      },
    };

    // Store new token
    this.tokens.set(newToken, {
      context,
      expiresAt: new Date(now + 3600000),
    });
    this.refreshTokens.set(newRefreshToken, user.userId);

    // Invalidate old refresh token
    this.refreshTokens.delete(refreshToken);

    return context;
  };

  /**
   * Invalidate a token
   */
  invalidateToken(token: string): void {
    this.tokens.delete(token);
  }

  /**
   * Simulate slow authentication (for timeout testing)
   */
  createSlowAuthenticate(delayMs: number) {
    return async (credentials: AuthCredentials): Promise<AuthContext> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.authenticate(credentials);
    };
  }

  /**
   * Create a token that expires after a specific time
   */
  createExpiringToken(userId: string, expiresInMs: number): string {
    const now = Date.now();
    const token = 'expiring-token-' + userId + '-' + now;
    const user = [...this.users.values()].find((u) => u.userId === userId);

    if (!user) {
      throw new Error('User not found');
    }

    const context: AuthContext = {
      userId: user.userId,
      roles: user.roles,
      permissions: user.permissions,
      token: {
        type: 'bearer',
        expiresAt: new Date(now + expiresInMs),
      },
    };

    this.tokens.set(token, {
      context,
      expiresAt: new Date(now + expiresInMs),
    });

    return token;
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.users.clear();
    this.tokens.clear();
    this.refreshTokens.clear();
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('AuthenticationManager Integration Tests', () => {
  let authManager: AuthenticationManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let authHandler: TestAuthHandler;

  beforeEach(() => {
    mockLogger = createMockLogger();
    authHandler = new TestAuthHandler();

    // Add test users
    authHandler.addUser({
      userId: 'user-1',
      username: 'alice',
      password: 'alice123',
      roles: ['user'],
      permissions: ['read:documents'],
    });

    authHandler.addUser({
      userId: 'user-2',
      username: 'bob',
      password: 'bob456',
      roles: ['user', 'admin'],
      permissions: ['read:documents', 'write:documents', 'delete:documents'],
    });

    authHandler.addUser({
      userId: 'user-3',
      username: 'charlie',
      password: 'charlie789',
      roles: ['guest'],
      permissions: ['read:public'],
    });

    authManager = new AuthenticationManager(mockLogger);
  });

  afterEach(() => {
    authHandler.clear();
    mockLogger.clearLogs();
  });

  // ==========================================================================
  // Test authenticate() with different handlers
  // ==========================================================================

  describe('authenticate() with different handlers', () => {
    it('should authenticate valid user with username/password', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      const result = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('user-1');
      expect(result.context?.roles).toContain('user');
      expect(result.context?.permissions).toContain('read:documents');
    });

    it('should reject invalid credentials', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      const result = await authManager.authenticate({
        username: 'alice',
        password: 'wrongpassword',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    it('should authenticate admin user with full permissions', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      const result = await authManager.authenticate({
        username: 'bob',
        password: 'bob456',
      });

      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('user-2');
      expect(result.context?.roles).toEqual(['user', 'admin']);
      expect(result.context?.permissions).toHaveLength(3);
    });

    it('should authenticate guest user with limited permissions', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      const result = await authManager.authenticate({
        username: 'charlie',
        password: 'charlie789',
      });

      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('user-3');
      expect(result.context?.roles).toEqual(['guest']);
      expect(result.context?.permissions).toEqual(['read:public']);
    });

    it('should support custom authentication handlers', async () => {
      // Custom API key handler
      const apiKeyHandler = async (credentials: AuthCredentials): Promise<AuthContext> => {
        const apiKey = credentials.apiKey as string;

        if (apiKey === 'valid-api-key-123') {
          return {
            userId: 'api-user-1',
            roles: ['api-client'],
            permissions: ['api:read', 'api:write'],
          };
        }

        throw new Error('Invalid API key');
      };

      authManager.configure({
        authenticate: apiKeyHandler,
      });

      const result = await authManager.authenticate({
        apiKey: 'valid-api-key-123',
      });

      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('api-user-1');
      expect(result.context?.roles).toContain('api-client');
    });

    it('should support OAuth2-style handler', async () => {
      const now = Date.now();
      const oauth2Handler = async (credentials: AuthCredentials): Promise<AuthContext> => {
        const code = credentials.code as string;
        const clientId = credentials.clientId as string;

        if (code === 'auth-code-123' && clientId === 'my-client') {
          return {
            userId: 'oauth-user-1',
            roles: ['user'],
            permissions: ['profile:read'],
            scopes: ['openid', 'profile', 'email'],
            token: {
              type: 'bearer',
              expiresAt: new Date(now + 3600000),
              issuer: 'https://auth.example.com',
              audience: ['https://api.example.com'],
            },
          };
        }

        throw new Error('Invalid authorization code');
      };

      authManager.configure({
        authenticate: oauth2Handler,
      });

      const result = await authManager.authenticate({
        code: 'auth-code-123',
        clientId: 'my-client',
      });

      expect(result.success).toBe(true);
      expect(result.context?.scopes).toContain('openid');
      expect(result.context?.token?.issuer).toBe('https://auth.example.com');
    });
  });

  // ==========================================================================
  // Test validateToken() with caching
  // ==========================================================================

  describe('validateToken() with caching', () => {
    it('should validate token and cache the result', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000, // 1 minute
        },
      });

      // First authenticate to get a token
      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      expect(authResult.success).toBe(true);
      const token = authResult.context?.metadata?.accessToken as string;

      // Validate token - should call handler
      const result1 = await authManager.validateToken(token);
      expect(result1.success).toBe(true);

      // Get cache stats
      let stats = authManager.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Validate same token again - should use cache
      const result2 = await authManager.validateToken(token);
      expect(result2.success).toBe(true);

      stats = authManager.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should respect cache TTL', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 100, // 100ms for testing
        },
      });

      const authResult = await authManager.authenticate({
        username: 'bob',
        password: 'bob456',
      });

      const token = authResult.context?.metadata?.accessToken as string;

      // First validation - cache miss
      await authManager.validateToken(token);
      let stats = authManager.getCacheStats();
      expect(stats.misses).toBe(1);

      // Second validation - cache hit
      await authManager.validateToken(token);
      stats = authManager.getCacheStats();
      expect(stats.hits).toBe(1);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Third validation - cache expired, should miss again
      await authManager.validateToken(token);
      stats = authManager.getCacheStats();
      expect(stats.misses).toBe(2);
    });

    it('should not cache when disabled', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: false,
        },
      });

      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      const token = authResult.context?.metadata?.accessToken as string;

      // Multiple validations should all call the handler
      await authManager.validateToken(token);
      await authManager.validateToken(token);
      await authManager.validateToken(token);

      const stats = authManager.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should cache different tokens separately', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      // Authenticate two users
      const auth1 = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      const auth2 = await authManager.authenticate({
        username: 'bob',
        password: 'bob456',
      });

      const token1 = auth1.context?.metadata?.accessToken as string;
      const token2 = auth2.context?.metadata?.accessToken as string;

      // Validate both tokens (cache misses)
      await authManager.validateToken(token1);
      await authManager.validateToken(token2);

      let stats = authManager.getCacheStats();
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);

      // Validate again (cache hits)
      await authManager.validateToken(token1);
      await authManager.validateToken(token2);

      stats = authManager.getCacheStats();
      expect(stats.hits).toBe(2);
    });
  });

  // ==========================================================================
  // Test token refresh
  // ==========================================================================

  describe('token refresh', () => {
    it('should handle token refresh flow', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
      });

      // Initial authentication
      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      expect(authResult.success).toBe(true);
      const refreshToken = authResult.context?.metadata?.refreshToken as string;
      const originalAccessToken = authResult.context?.metadata?.accessToken as string;

      // Wait a tiny bit to ensure different timestamp (Date.now() can be same in quick succession)
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Refresh the token
      const newContext = await authHandler.refreshToken(refreshToken);

      expect(newContext.userId).toBe('user-1');
      expect(newContext.metadata?.accessToken).toBeDefined();
      expect(newContext.metadata?.refreshToken).toBeDefined();
      // New tokens should be different from original
      expect(newContext.metadata?.accessToken).not.toBe(originalAccessToken);
    });

    it('should invalidate old token after refresh', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      // Initial authentication
      const authResult = await authManager.authenticate({
        username: 'bob',
        password: 'bob456',
      });

      const oldToken = authResult.context?.metadata?.accessToken as string;
      const refreshToken = authResult.context?.metadata?.refreshToken as string;

      // Validate old token works
      const validateResult = await authManager.validateToken(oldToken);
      expect(validateResult.success).toBe(true);

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Refresh token
      const newContext = await authHandler.refreshToken(refreshToken);
      const newToken = newContext.metadata?.accessToken as string;

      // Invalidate old token
      authHandler.invalidateToken(oldToken);
      authManager.clearCache(); // Clear cache to force revalidation

      // Old token should now fail
      const oldTokenResult = await authManager.validateToken(oldToken);
      expect(oldTokenResult.success).toBe(false);

      // New token should work
      const newTokenResult = await authManager.validateToken(newToken);
      expect(newTokenResult.success).toBe(true);
    });

    it('should reject invalid refresh token', async () => {
      await expect(authHandler.refreshToken('invalid-refresh-token')).rejects.toThrow('Invalid refresh token');
    });
  });

  // ==========================================================================
  // Test timeout scenarios
  // ==========================================================================

  describe('timeout scenarios', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should timeout slow authentication', async () => {
      const slowAuth = authHandler.createSlowAuthenticate(5000);

      authManager.configure({
        authenticate: slowAuth,
      });
      authManager.setTimeout(1000);

      const resultPromise = authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      // Fast-forward time
      vi.advanceTimersByTime(1000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should complete before timeout if handler is fast', async () => {
      // Use real timers for this test
      vi.useRealTimers();

      authManager.configure({
        authenticate: authHandler.authenticate,
      });
      authManager.setTimeout(5000);

      const result = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      expect(result.success).toBe(true);
    });

    it('should timeout slow token validation', async () => {
      const slowValidate = async (token: string): Promise<AuthContext> => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return authHandler.validateToken(token);
      };

      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: slowValidate,
      });
      authManager.setTimeout(1000);

      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      // Use real timers briefly to get a valid token
      vi.useRealTimers();
      const token = authResult.context?.metadata?.accessToken as string;
      vi.useFakeTimers();

      const validatePromise = authManager.validateToken(token);
      vi.advanceTimersByTime(1000);

      const result = await validatePromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should reject invalid timeout values', () => {
      expect(() => authManager.setTimeout(0)).toThrow(RangeError);
      expect(() => authManager.setTimeout(-100)).toThrow(RangeError);
    });
  });

  // ==========================================================================
  // Test cache invalidation
  // ==========================================================================

  describe('cache invalidation', () => {
    it('should clear all cache entries', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      // Authenticate multiple users
      const auth1 = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      const auth2 = await authManager.authenticate({
        username: 'bob',
        password: 'bob456',
      });

      const token1 = auth1.context?.metadata?.accessToken as string;
      const token2 = auth2.context?.metadata?.accessToken as string;

      // Validate tokens (cache them)
      await authManager.validateToken(token1);
      await authManager.validateToken(token2);

      let stats = authManager.getCacheStats();
      expect(stats.size).toBe(2);

      // Clear cache
      authManager.clearCache();

      stats = authManager.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should invalidate specific token when cleared from handler', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      const token = authResult.context?.metadata?.accessToken as string;

      // Cache the token
      await authManager.validateToken(token);

      // Invalidate in handler and clear cache
      authHandler.invalidateToken(token);
      authManager.clearCache();

      // Token should now fail
      const result = await authManager.validateToken(token);
      expect(result.success).toBe(false);
    });

    it('should handle expired tokens correctly', async () => {
      authHandler.addUser({
        userId: 'user-expiring',
        username: 'expiring',
        password: 'exp123',
        roles: ['user'],
        permissions: [],
      });

      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 50, // Very short cache TTL
        },
      });

      // Create a token that expires quickly
      const token = authHandler.createExpiringToken('user-expiring', 100);

      // Validate immediately - should work
      const result1 = await authManager.validateToken(token);
      expect(result1.success).toBe(true);

      // Wait for both cache and token to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Clear cache to ensure fresh validation
      authManager.clearCache();

      // Token should now be expired
      const result2 = await authManager.validateToken(token);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('expired');
    });
  });

  // ==========================================================================
  // Test registerHandler() pattern for custom auth handlers
  // ==========================================================================

  describe('registerHandler() pattern', () => {
    it('should support reconfiguration with new handlers', async () => {
      // Initial handler
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      let result = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('user-1');

      // Reconfigure with different handler
      const customHandler = async (): Promise<AuthContext> => ({
        userId: 'custom-user',
        roles: ['custom'],
        permissions: [],
      });

      authManager.configure({
        authenticate: customHandler,
      });

      result = await authManager.authenticate({
        any: 'credentials',
      });
      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('custom-user');
    });

    it('should support handler composition', async () => {
      // Primary handler - tries username/password
      const primaryHandler = async (credentials: AuthCredentials): Promise<AuthContext> => {
        if (credentials.username && credentials.password) {
          return authHandler.authenticate(credentials);
        }
        throw new Error('Primary authentication failed');
      };

      // Fallback handler - tries API key
      const fallbackHandler = async (credentials: AuthCredentials): Promise<AuthContext> => {
        if (credentials.apiKey === 'fallback-key') {
          return {
            userId: 'fallback-user',
            roles: ['fallback'],
            permissions: [],
          };
        }
        throw new Error('Fallback authentication failed');
      };

      // Composed handler
      const composedHandler = async (credentials: AuthCredentials): Promise<AuthContext> => {
        try {
          return await primaryHandler(credentials);
        } catch {
          return await fallbackHandler(credentials);
        }
      };

      authManager.configure({
        authenticate: composedHandler,
      });

      // Primary auth should work
      const result1 = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      expect(result1.success).toBe(true);
      expect(result1.context?.userId).toBe('user-1');

      // Fallback auth should work
      const result2 = await authManager.authenticate({
        apiKey: 'fallback-key',
      });
      expect(result2.success).toBe(true);
      expect(result2.context?.userId).toBe('fallback-user');
    });

    it('should validate handler type on configuration', () => {
      expect(() => {
        authManager.configure({
          authenticate: 'not-a-function' as any,
        });
      }).toThrow(TypeError);

      expect(() => {
        authManager.configure({
          authenticate: authHandler.authenticate,
          validateToken: 123 as any,
        });
      }).toThrow(TypeError);
    });
  });

  // ==========================================================================
  // Test concurrent authentication requests
  // ==========================================================================

  describe('concurrent authentication requests', () => {
    it('should handle multiple concurrent authentications', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      // Create 50 concurrent authentication requests
      const promises = [];
      for (let i = 0; i < 50; i++) {
        const user = i % 3 === 0 ? 'alice' : i % 3 === 1 ? 'bob' : 'charlie';
        const password = user === 'alice' ? 'alice123' : user === 'bob' ? 'bob456' : 'charlie789';
        promises.push(
          authManager.authenticate({
            username: user,
            password,
          })
        );
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should handle concurrent token validations with caching', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      // Authenticate to get a token
      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      const token = authResult.context?.metadata?.accessToken as string;

      // First validate to populate cache
      await authManager.validateToken(token);

      // Now run concurrent validations - all should hit cache
      const promises = Array.from({ length: 100 }, () => authManager.validateToken(token));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      expect(results.every((r) => r.success)).toBe(true);

      // After initial miss, subsequent calls should be cache hits
      const stats = authManager.getCacheStats();
      expect(stats.hits).toBeGreaterThanOrEqual(100); // All 100 concurrent calls should hit cache
      expect(stats.misses).toBe(1); // Only the initial validation was a miss
    });

    it('should handle mixed concurrent operations', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      // Get some tokens first
      const tokens: string[] = [];
      for (const user of ['alice', 'bob']) {
        const result = await authManager.authenticate({
          username: user,
          password: user === 'alice' ? 'alice123' : 'bob456',
        });
        tokens.push(result.context?.metadata?.accessToken as string);
      }

      // Mix of authentications and validations
      const promises: Promise<any>[] = [];

      for (let i = 0; i < 30; i++) {
        if (i % 3 === 0) {
          // Authentication
          promises.push(
            authManager.authenticate({
              username: 'charlie',
              password: 'charlie789',
            })
          );
        } else {
          // Token validation
          promises.push(authManager.validateToken(tokens[i % 2]));
        }
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(30);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  // ==========================================================================
  // Test destroy() cleanup (via clearCache and reconfiguration)
  // ==========================================================================

  describe('cleanup patterns', () => {
    it('should clear cache on cleanup', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
        },
      });

      // Populate cache
      const authResult = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      const token = authResult.context?.metadata?.accessToken as string;
      await authManager.validateToken(token);

      let stats = authManager.getCacheStats();
      expect(stats.size).toBe(1);

      // Cleanup
      authManager.clearCache();

      stats = authManager.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should be reconfigurable after cleanup', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      // Use the manager
      let result = await authManager.authenticate({
        username: 'alice',
        password: 'alice123',
      });
      expect(result.success).toBe(true);

      // Cleanup
      authManager.clearCache();

      // Reconfigure
      const newHandler = async (): Promise<AuthContext> => ({
        userId: 'new-user',
        roles: [],
        permissions: [],
      });

      authManager.configure({
        authenticate: newHandler,
      });

      // Use again
      result = await authManager.authenticate({});
      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('new-user');
    });

    it('should handle multiple cleanup cycles', async () => {
      for (let cycle = 0; cycle < 5; cycle++) {
        authManager.configure({
          authenticate: authHandler.authenticate,
          validateToken: authHandler.validateToken,
          tokenCache: {
            enabled: true,
            ttl: 60000,
          },
        });

        // Use the manager
        const authResult = await authManager.authenticate({
          username: 'bob',
          password: 'bob456',
        });
        const token = authResult.context?.metadata?.accessToken as string;
        await authManager.validateToken(token);

        // Cleanup
        authManager.clearCache();

        const stats = authManager.getCacheStats();
        expect(stats.size).toBe(0);
      }
    });
  });

  // ==========================================================================
  // Test with AuditLogger integration
  // ==========================================================================

  describe('AuditLogger integration', () => {
    it('should log authentication events to audit logger', async () => {
      const auditAdapter = new MemoryAuditAdapter();
      const auditLogger = new AuditLogger(mockLogger, {
        storage: auditAdapter,
        includeArgs: true,
        async: false, // Synchronous for testing
      });

      const managerWithAudit = new AuthenticationManager(mockLogger, undefined, auditLogger);

      managerWithAudit.configure({
        authenticate: authHandler.authenticate,
      });

      await managerWithAudit.authenticate({
        username: 'alice',
        password: 'alice123',
      });

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await auditLogger.query({ service: 'authentication' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should log failed authentication attempts', async () => {
      const auditAdapter = new MemoryAuditAdapter();
      const auditLogger = new AuditLogger(mockLogger, {
        storage: auditAdapter,
        async: false,
      });

      const managerWithAudit = new AuthenticationManager(mockLogger, undefined, auditLogger);

      managerWithAudit.configure({
        authenticate: authHandler.authenticate,
      });

      await managerWithAudit.authenticate({
        username: 'alice',
        password: 'wrongpassword',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await auditLogger.query({
        service: 'authentication',
        success: false,
      });

      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Edge cases and error handling
  // ==========================================================================

  describe('edge cases and error handling', () => {
    it('should handle handler throwing non-Error objects', async () => {
      const throwingHandler = async (): Promise<AuthContext> => {
        throw 'string error';
      };

      authManager.configure({
        authenticate: throwingHandler,
      });

      const result = await authManager.authenticate({
        username: 'test',
        password: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed');
    });

    it('should handle handler returning undefined', async () => {
      const undefinedHandler = async (): Promise<AuthContext> => undefined as any;

      authManager.configure({
        authenticate: undefinedHandler,
      });

      const result = await authManager.authenticate({
        username: 'test',
        password: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no context returned');
    });

    it('should handle handler returning null', async () => {
      const nullHandler = async (): Promise<AuthContext> => null as any;

      authManager.configure({
        authenticate: nullHandler,
      });

      const result = await authManager.authenticate({
        username: 'test',
        password: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no context returned');
    });

    it('should handle synchronous handlers', async () => {
      const syncHandler = (credentials: AuthCredentials): AuthContext => {
        if (credentials.username === 'sync-user') {
          return {
            userId: 'sync-1',
            roles: ['user'],
            permissions: [],
          };
        }
        throw new Error('Invalid user');
      };

      authManager.configure({
        authenticate: syncHandler,
      });

      const result = await authManager.authenticate({
        username: 'sync-user',
        password: 'any',
      });

      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('sync-1');
    });

    it('should reject when not configured', async () => {
      const result = await authManager.authenticate({
        username: 'test',
        password: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication not configured');
    });

    it('should report configuration status correctly', () => {
      expect(authManager.isConfigured()).toBe(false);
      expect(authManager.isTokenValidationConfigured()).toBe(false);

      authManager.configure({
        authenticate: authHandler.authenticate,
      });

      expect(authManager.isConfigured()).toBe(true);
      expect(authManager.isTokenValidationConfigured()).toBe(false);

      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
      });

      expect(authManager.isConfigured()).toBe(true);
      expect(authManager.isTokenValidationConfigured()).toBe(true);
    });
  });

  // ==========================================================================
  // Cache max size enforcement
  // ==========================================================================

  describe('cache max size', () => {
    it('should respect maxSize configuration', async () => {
      authManager.configure({
        authenticate: authHandler.authenticate,
        validateToken: authHandler.validateToken,
        tokenCache: {
          enabled: true,
          ttl: 60000,
          maxSize: 3,
        },
      });

      // Create 5 different tokens
      const tokens: string[] = [];
      for (let i = 0; i < 5; i++) {
        authHandler.addUser({
          userId: 'cache-user-' + i,
          username: 'cache-user-' + i,
          password: 'password',
          roles: [],
          permissions: [],
        });

        const result = await authManager.authenticate({
          username: 'cache-user-' + i,
          password: 'password',
        });
        tokens.push(result.context?.metadata?.accessToken as string);
      }

      // Validate all tokens
      for (const token of tokens) {
        await authManager.validateToken(token);
      }

      // Cache should be at max size (3), not 5
      const stats = authManager.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(3);
    });
  });
});
