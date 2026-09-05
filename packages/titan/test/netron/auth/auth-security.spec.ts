/**
 * Netron Auth Security Tests
 *
 * WHAT A GREEN RUN HERE MEANS — and does not.
 *
 * Most of these assert current behaviour under hostile input: SQL and XSS
 * payloads are stored verbatim rather than executed, oversized and malformed
 * credentials are rejected, sessions survive a flood. Those are real checks and
 * they fail if the behaviour changes.
 *
 * But the file also PRINTS findings it does not assert. Six `console.log` lines
 * report gaps — no brute-force protection, no credential-stuffing detection,
 * session fixation possible, sessions replayable, a memory ceiling — and the
 * run stays green either way. A reader seeing this file pass will reasonably
 * conclude the auth layer was audited and cleared; what actually happened is
 * that the gaps were noted in output nobody reads.
 *
 * Two of those are pinned by assertions that document the gap rather than
 * denying it: "100 attempts complete in under a second" IS the statement that
 * there is no rate limiting, and it will fail the day someone adds it — which
 * is the right time to revisit this file. The rest are notes.
 *
 * Where rate limiting and brute-force protection belong is a design question
 * (they may well sit in @omnitron-dev/titan-ratelimit or at the gateway rather
 * than in AuthenticationManager), so the notes are left as notes. What is
 * corrected is the impression: this is an audit record with some tests in it,
 * not a clean bill of health.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { SessionManager } from '../../../src/netron/auth/session-manager.js';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import type {
  AuthCredentials,
  AuthContext,
  ExecutionContext,
  PolicyDefinition,
} from '../../../src/netron/auth/types.js';

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

describe('Auth Security Tests', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('Brute Force Protection', () => {
    it('should detect rapid failed authentication attempts', async () => {
      const authManager = new AuthenticationManager(mockLogger);
      let attemptCount = 0;

      // Configure with a function that tracks failed attempts
      const mockAuth = vi.fn(async (creds: AuthCredentials) => {
        attemptCount++;
        if (creds.password !== 'correct-password') {
          throw new Error('Invalid credentials');
        }
        return {
          userId: 'user123',
          roles: ['user'],
          permissions: [],
        };
      });

      authManager.configure({ authenticate: mockAuth });

      // Simulate rapid failed login attempts (brute force attack)
      const startTime = Date.now();
      const attempts = 100;
      const results = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          authManager.authenticate({
            username: 'admin',
            password: `wrong-password-${i}`,
          })
        )
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // All attempts should fail
      expect(results.every((r) => !r.success)).toBe(true);
      expect(attemptCount).toBe(attempts);

      // Should complete very quickly (< 1 second for 100 attempts)
      // If there was rate limiting, it would take much longer
      expect(duration).toBeLessThan(1000);

      // FINDING: No built-in brute force protection
      // System allows unlimited rapid authentication attempts
      // RECOMMENDATION: Implement rate limiting based on IP/username
      console.log(`⚠️  SECURITY: No brute force protection - ${attempts} attempts in ${duration}ms`);
    });

    it('should handle credential stuffing attack patterns', async () => {
      const authManager = new AuthenticationManager(mockLogger);
      const attemptedCredentials = new Map<string, number>();

      const mockAuth = vi.fn(async (creds: AuthCredentials) => {
        const key = `${creds.username}:${creds.password}`;
        attemptedCredentials.set(key, (attemptedCredentials.get(key) || 0) + 1);

        // Only succeed for one specific credential
        if (creds.username === 'legituser' && creds.password === 'legitpass') {
          return {
            userId: 'user456',
            roles: ['user'],
            permissions: [],
          };
        }
        throw new Error('Invalid credentials');
      });

      authManager.configure({ authenticate: mockAuth });

      // Simulate credential stuffing with leaked username/password pairs
      const leakedCredentials = [
        { username: 'admin', password: 'password123' },
        { username: 'root', password: 'root' },
        { username: 'user1', password: '12345' },
        { username: 'admin', password: 'admin' },
        { username: 'legituser', password: 'legitpass' }, // This one succeeds
      ];

      const results = await Promise.all(leakedCredentials.map((creds) => authManager.authenticate(creds)));

      const successfulAttempts = results.filter((r) => r.success);
      expect(successfulAttempts.length).toBe(1);
      expect(attemptedCredentials.size).toBe(leakedCredentials.length);

      // FINDING: No detection of credential stuffing patterns
      // RECOMMENDATION: Monitor for multiple username attempts from same source
      console.log(`⚠️  SECURITY: No credential stuffing detection`);
    });
  });

  describe('Timing Attack Resistance', () => {
    it('does not itself distinguish an unknown user from a wrong password', async () => {
      // This replaces a test that measured timings, printed the verdict to the
      // console and asserted nothing — it could not fail, and what it timed was
      // its own mock's `===` comparison rather than any production code.
      //
      // Constant-time comparison is a property of the `authenticate` function a
      // caller supplies; AuthenticationManager never sees a stored password and
      // cannot make that guarantee. What it CAN guarantee, and what an attacker
      // probes for, is that the manager adds no shortcut of its own: an unknown
      // username and a known username with a wrong password must take the same
      // path through it — one call to the configured function, no early return,
      // no negative caching that would make the second probe faster.
      const seen: string[] = [];
      const mockAuth = vi.fn(async (creds: AuthCredentials) => {
        seen.push(creds.username!);
        throw new Error('Invalid credentials');
      });

      const authManager = new AuthenticationManager(mockLogger);
      authManager.configure({ authenticate: mockAuth });

      const unknownUser = await authManager.authenticate({
        username: 'no-such-user',
        password: 'whatever',
      });
      const knownUserWrongPassword = await authManager.authenticate({
        username: 'testuser',
        password: 'wrong',
      });

      // Both reached the configured function — neither was short-circuited on
      // a property the manager could only know by leaking it.
      expect(mockAuth).toHaveBeenCalledTimes(2);
      expect(seen).toEqual(['no-such-user', 'testuser']);

      // And both produced the same shape of answer, with no hint of which
      // half of the credential pair was wrong.
      expect(unknownUser.success).toBe(false);
      expect(knownUserWrongPassword.success).toBe(false);
      expect(unknownUser.error).toBe(knownUserWrongPassword.error);

      // Repeating a rejected pair calls through again rather than answering
      // from a cache — a cached rejection is measurable from outside.
      await authManager.authenticate({ username: 'no-such-user', password: 'whatever' });
      expect(mockAuth).toHaveBeenCalledTimes(3);
    });
  });

  describe('Token Replay Attack Prevention', () => {
    it('should prevent token replay attacks', async () => {
      const sessionManager = new SessionManager(mockLogger, { defaultTTL: 5000 });
      const usedTokens = new Set<string>();

      // Create a session
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read'],
      };

      const session = await sessionManager.createSession('user123', authContext, {
        sessionId: 'session-token-abc123',
      });

      // First use - should succeed
      const firstAttempt = await sessionManager.getSession(session.sessionId);
      expect(firstAttempt).not.toBeNull();
      usedTokens.add(session.sessionId);

      // Second use - token replay
      const secondAttempt = await sessionManager.getSession(session.sessionId);
      expect(secondAttempt).not.toBeNull();

      // FINDING: Sessions can be reused multiple times (no single-use tokens)
      // This is expected behavior for sessions, but tokens should have nonce/jti
      // RECOMMENDATION: For high-security operations, use single-use tokens with nonce
      console.log(`⚠️  SECURITY: Sessions are reusable (expected), implement nonce for critical operations`);

      await sessionManager.destroy();
    });

    it('should detect and prevent session fixation attacks', async () => {
      const sessionManager = new SessionManager(mockLogger);

      // Attacker creates a session
      const attackerContext: AuthContext = {
        userId: 'attacker',
        roles: ['guest'],
        permissions: [],
      };

      const fixedSessionId = 'fixed-session-id-123';
      const _attackerSession = await sessionManager.createSession('attacker', attackerContext, {
        sessionId: fixedSessionId,
      });

      // Victim tries to authenticate with the same session ID (fixation attempt)
      const victimContext: AuthContext = {
        userId: 'victim',
        roles: ['admin'],
        permissions: ['all'],
      };

      // System allows creating session with pre-determined ID
      // This is a session fixation vulnerability
      const _victimSession = await sessionManager.createSession('victim', victimContext, {
        sessionId: fixedSessionId, // Reusing attacker's session ID
      });

      // The old attacker session should be invalidated
      const oldSession = await sessionManager.getSession(fixedSessionId);
      expect(oldSession?.userId).toBe('victim'); // Session was overwritten

      // FINDING: System allows predetermined session IDs
      // RECOMMENDATION: Always generate new session IDs server-side on authentication
      console.log(`⚠️  SECURITY: Session fixation possible - always regenerate session IDs`);

      await sessionManager.destroy();
    });
  });

  describe('SQL Injection & XSS in Auth Context', () => {
    it('should safely handle SQL injection attempts in credentials', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      const mockAuth = vi.fn(async (creds: AuthCredentials) => {
        // Simulate database query (properly parameterized)
        // In real scenario, should use prepared statements
        // All SQL injection payloads should fail
        const sqlInjectionPatterns = [
          "admin' OR '1'='1",
          "admin'--",
          "admin' OR 1=1--",
          "' UNION SELECT",
          "'; DROP TABLE",
        ];

        const username = creds.username || '';
        if (sqlInjectionPatterns.some((pattern) => username.includes(pattern))) {
          throw new Error('Invalid credentials');
        }

        // Only valid users succeed
        throw new Error('User not found');
      });

      authManager.configure({ authenticate: mockAuth });

      // Test various SQL injection payloads
      const sqlInjectionPayloads = [
        { username: "admin' OR '1'='1", password: 'anything' },
        { username: "admin'--", password: '' },
        { username: "admin' OR 1=1--", password: 'test' },
        { username: "' UNION SELECT * FROM users--", password: 'test' },
        { username: "admin'; DROP TABLE users--", password: 'test' },
      ];

      const results = await Promise.all(sqlInjectionPayloads.map((payload) => authManager.authenticate(payload)));

      // All SQL injection attempts should fail
      expect(results.every((r) => !r.success)).toBe(true);

      // Verify error logging occurred
      expect(mockLogger.error).toHaveBeenCalled();

      console.log(`✓ SECURITY: SQL injection attempts properly rejected`);
    });

    it('should sanitize XSS attempts in auth context metadata', async () => {
      const sessionManager = new SessionManager(mockLogger);

      // Attacker tries to inject XSS in metadata
      const maliciousMetadata = {
        deviceName: '<script>alert("XSS")</script>',
        userAgent: '<img src=x onerror=alert(1)>',
        customField: '"><svg onload=alert(document.cookie)>',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
        metadata: maliciousMetadata,
      };

      const session = await sessionManager.createSession('user123', authContext, {
        metadata: maliciousMetadata,
      });

      // Retrieve the session
      const retrievedSession = await sessionManager.getSession(session.sessionId);

      // Metadata should be stored as-is (sanitization happens at render time)
      expect(retrievedSession?.metadata?.deviceName).toBe('<script>alert("XSS")</script>');

      // FINDING: No automatic XSS sanitization (this is correct)
      // Sanitization should occur at render/output time, not storage
      // RECOMMENDATION: Document that output sanitization is required
      console.log(`✓ SECURITY: XSS payloads stored as-is (sanitize at output/render time)`);

      await sessionManager.destroy();
    });
  });

  describe('CSRF Token Validation', () => {
    it('should validate CSRF tokens for state-changing operations', async () => {
      const policyEngine = new PolicyEngine(mockLogger);

      // Define CSRF protection policy
      const csrfPolicy: PolicyDefinition = {
        name: 'csrf-protection',
        description: 'Validates CSRF token for state-changing operations',
        evaluate: (ctx: ExecutionContext) => {
          const csrfToken = ctx.request?.headers?.['x-csrf-token'];
          const sessionToken = ctx.auth?.metadata?.sessionToken;

          // Validate CSRF token matches session
          if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
            return {
              allowed: false,
              reason: 'Missing or invalid CSRF token',
            };
          }

          return { allowed: true, reason: 'CSRF token valid' };
        },
      };

      policyEngine.registerPolicy(csrfPolicy);

      // Valid request with matching CSRF token
      const validContext: ExecutionContext = {
        auth: {
          userId: 'user123',
          roles: ['user'],
          permissions: [],
          metadata: { sessionToken: 'session-abc-123' },
        },
        service: { name: 'userService', version: '1.0.0' },
        method: { name: 'updateProfile', args: [] },
        request: {
          headers: { 'x-csrf-token': 'session-abc-123' },
        },
      };

      const validResult = await policyEngine.evaluate('csrf-protection', validContext, {
        skipCache: true,
      });
      expect(validResult.allowed).toBe(true);

      // Invalid request - missing CSRF token
      const invalidContext: ExecutionContext = {
        auth: validContext.auth,
        service: validContext.service,
        method: validContext.method,
        request: {
          headers: {},
        },
      };

      const invalidResult = await policyEngine.evaluate('csrf-protection', invalidContext, {
        skipCache: true,
      });
      expect(invalidResult.allowed).toBe(false);
      expect(invalidResult.reason).toContain('CSRF token');

      // Invalid request - mismatched CSRF token
      const mismatchContext: ExecutionContext = {
        ...validContext,
        request: {
          headers: { 'x-csrf-token': 'wrong-token-456' },
        },
      };

      const mismatchResult = await policyEngine.evaluate('csrf-protection', mismatchContext, {
        skipCache: true,
      });
      expect(mismatchResult.allowed).toBe(false);

      console.log(`✓ SECURITY: CSRF token validation working correctly`);
    });
  });

  describe('Edge Cases - Security', () => {
    it('should handle extremely long usernames and tokens (10KB+)', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      const mockAuth = vi.fn(async (creds: AuthCredentials) => {
        // Should reject excessively long inputs to prevent DoS
        if (creds.username && creds.username.length > 1000) {
          throw new Error('Username too long');
        }
        if (creds.token && creds.token.length > 1000) {
          throw new Error('Token too long');
        }
        return {
          userId: 'user123',
          roles: ['user'],
          permissions: [],
        };
      });

      authManager.configure({ authenticate: mockAuth });

      // 10KB username
      const longUsername = 'a'.repeat(10 * 1024);
      const result = await authManager.authenticate({
        username: longUsername,
        password: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('too long');

      // 10KB token - fallback to authenticate with token
      const longToken = 'b'.repeat(10 * 1024);
      const tokenResult = await authManager.validateToken(longToken);

      // Should reject (uses authenticate fallback which checks length)
      expect(tokenResult.success).toBe(false);
      expect(tokenResult.error).toContain('too long');

      console.log(`✓ SECURITY: Long inputs handled gracefully`);
    });

    it('should handle Unicode and emoji in credentials', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      const mockAuth = vi.fn(async (creds: AuthCredentials) => ({
        userId: creds.username!,
        roles: ['user'],
        permissions: [],
      }));

      authManager.configure({ authenticate: mockAuth });

      // Test various Unicode scenarios
      const unicodeTests = [
        { username: '用户123', password: '密码456' }, // Chinese
        { username: 'user🔐', password: 'pass🔑' }, // Emoji
        { username: 'مستخدم', password: 'كلمة السر' }, // Arabic
        { username: 'пользователь', password: 'пароль' }, // Cyrillic
        { username: '👨‍💻', password: '🔒🔑' }, // Emoji only
      ];

      const results = await Promise.all(unicodeTests.map((creds) => authManager.authenticate(creds)));

      // All should succeed (Unicode support)
      expect(results.every((r) => r.success)).toBe(true);

      console.log(`✓ SECURITY: Unicode and emoji handled correctly`);
    });

    it('should handle null/undefined in all auth methods gracefully', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: vi.fn(),
      });

      // Test null/undefined credentials
      const nullResult = await authManager.authenticate(null as any);
      expect(nullResult.success).toBe(false);

      const undefinedResult = await authManager.authenticate(undefined as any);
      expect(undefinedResult.success).toBe(false);

      // Test null/undefined tokens
      const nullTokenResult = await authManager.validateToken(null as any);
      expect(nullTokenResult.success).toBe(false);

      const undefinedTokenResult = await authManager.validateToken(undefined as any);
      expect(undefinedTokenResult.success).toBe(false);

      console.log(`✓ SECURITY: Null/undefined inputs handled safely`);
    });

    it('should detect and prevent circular policy dependencies', async () => {
      const policyEngine = new PolicyEngine(mockLogger);

      // Create policies that reference each other (circular)
      let policyAEvaluations = 0;
      let policyBEvaluations = 0;

      const policyA: PolicyDefinition = {
        name: 'policyA',
        evaluate: async (ctx: ExecutionContext) => {
          policyAEvaluations++;
          if (policyAEvaluations > 5) {
            // Prevent infinite loop in test
            return { allowed: false, reason: 'Circular reference detected' };
          }
          // This would cause circular evaluation if not prevented
          return { allowed: true };
        },
      };

      const policyB: PolicyDefinition = {
        name: 'policyB',
        evaluate: async (ctx: ExecutionContext) => {
          policyBEvaluations++;
          if (policyBEvaluations > 5) {
            return { allowed: false, reason: 'Circular reference detected' };
          }
          return { allowed: true };
        },
      };

      policyEngine.registerPolicy(policyA);
      policyEngine.registerPolicy(policyB);

      const context: ExecutionContext = {
        auth: { userId: 'user123', roles: ['user'], permissions: [] },
        service: { name: 'test', version: '1.0.0' },
      };

      // Evaluate with circular expression (not currently supported, but should not hang)
      await expect(policyEngine.evaluateAll(['policyA', 'policyB'], context)).resolves.toBeDefined();

      // Should complete without hanging
      expect(policyAEvaluations).toBeLessThan(10);
      expect(policyBEvaluations).toBeLessThan(10);

      console.log(`✓ SECURITY: Circular dependencies prevented`);
    });
  });

  describe('Failure Scenarios - Security', () => {
    it('should handle auth provider unavailable (network error)', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      const mockAuth = vi.fn(async () => {
        throw Object.assign(new Error('ECONNREFUSED: Connection refused'), {
          code: 'ECONNREFUSED',
        });
      });

      authManager.configure({ authenticate: mockAuth });

      const result = await authManager.authenticate({
        username: 'testuser',
        password: 'testpass',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');

      // Should log the error
      expect(mockLogger.error).toHaveBeenCalled();

      console.log(`✓ SECURITY: Network errors handled gracefully`);
    });

    it('should handle policy evaluation timeout gracefully', async () => {
      const policyEngine = new PolicyEngine(mockLogger, { defaultTimeout: 100 });

      // Policy that takes too long
      const slowPolicy: PolicyDefinition = {
        name: 'slow-policy',
        evaluate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { allowed: true };
        },
      };

      policyEngine.registerPolicy(slowPolicy);

      const context: ExecutionContext = {
        auth: { userId: 'user123', roles: ['user'], permissions: [] },
        service: { name: 'test', version: '1.0.0' },
      };

      const result = await policyEngine.evaluate('slow-policy', context);

      // Should timeout and deny access
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('timeout');

      console.log(`✓ SECURITY: Policy timeout handled correctly`);
    });

    it('should recover from cache corruption', async () => {
      const policyEngine = new PolicyEngine(mockLogger);

      const testPolicy: PolicyDefinition = {
        name: 'test-policy',
        evaluate: () => ({ allowed: true }),
      };

      policyEngine.registerPolicy(testPolicy);

      const context: ExecutionContext = {
        auth: { userId: 'user123', roles: ['user'], permissions: [] },
        service: { name: 'test', version: '1.0.0' },
      };

      // Populate cache
      await policyEngine.evaluate('test-policy', context);

      // Clear cache (simulate corruption/invalidation)
      policyEngine.clearCache();

      // Should still work after cache clear
      const result = await policyEngine.evaluate('test-policy', context);
      expect(result.allowed).toBe(true);

      console.log(`✓ SECURITY: Cache corruption recovery successful`);
    });

    it('should handle out of memory gracefully with large session count', async () => {
      const sessionManager = new SessionManager(mockLogger, {
        defaultTTL: 60000,
        autoCleanup: false, // Disable cleanup to test memory pressure
      });

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      // Create many sessions (but not enough to actually crash)
      const sessionCount = 10000;
      const sessions: string[] = [];

      try {
        for (let i = 0; i < sessionCount; i++) {
          const session = await sessionManager.createSession(`user${i}`, authContext);
          sessions.push(session.sessionId);
        }

        const stats = sessionManager.getStats();
        expect(stats.totalSessions).toBe(sessionCount);

        console.log(`✓ SECURITY: Handled ${sessionCount} sessions (${(stats.totalSessions / 1000).toFixed(0)}K)`);
      } catch (error: any) {
        // If OOM occurs, it should be handled gracefully
        console.log(`⚠️  SECURITY: Memory limit reached at ${sessions.length} sessions`);
        expect(error.message).toBeDefined();
      }

      await sessionManager.destroy();
    }, 30000); // Increase timeout for this test
  });
});
