/**
 * Utils Integration Tests
 *
 * Tests for authentication utility functions including
 * extractBearerToken and safeCompare.
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect } from 'vitest';
import { extractBearerToken, safeCompare } from '../../../src/netron/auth/utils.js';

describe('Authentication Utils', () => {
  // ==========================================================================
  // extractBearerToken Tests
  // ==========================================================================

  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
      const token = extractBearerToken('Bearer abc123');
      expect(token).toBe('abc123');
    });

    it('should extract token with special characters', () => {
      const token = extractBearerToken('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature');
      expect(token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature');
    });

    it('should return null for undefined header', () => {
      const token = extractBearerToken(undefined);
      expect(token).toBeNull();
    });

    it('should return null for empty string', () => {
      const token = extractBearerToken('');
      expect(token).toBeNull();
    });

    it('should return null for non-Bearer scheme', () => {
      const token = extractBearerToken('Basic abc123');
      expect(token).toBeNull();
    });

    it('should return null for malformed header (no token)', () => {
      const token = extractBearerToken('Bearer');
      expect(token).toBeNull();
    });

    it('should return null for malformed header (extra parts)', () => {
      const token = extractBearerToken('Bearer abc 123');
      expect(token).toBeNull();
    });

    it('should be case-sensitive for scheme', () => {
      const token = extractBearerToken('bearer abc123');
      expect(token).toBeNull();
    });

    it('should handle non-string input gracefully', () => {
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(extractBearerToken(123)).toBeNull();
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(extractBearerToken(null)).toBeNull();
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(extractBearerToken({})).toBeNull();
    });
  });

  // ==========================================================================
  // safeCompare Tests - Timing Attack Prevention
  // ==========================================================================

  describe('safeCompare', () => {
    it('should return true for equal strings', () => {
      expect(safeCompare('hello', 'hello')).toBe(true);
      expect(safeCompare('', '')).toBe(true);
      expect(safeCompare('user-123', 'user-123')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(safeCompare('hello', 'world')).toBe(false);
      expect(safeCompare('abc', 'abcd')).toBe(false);
      expect(safeCompare('user-123', 'user-456')).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(safeCompare('short', 'longerstring')).toBe(false);
      expect(safeCompare('a', '')).toBe(false);
      expect(safeCompare('', 'a')).toBe(false);
    });

    it('should handle special characters', () => {
      expect(safeCompare('user@example.com', 'user@example.com')).toBe(true);
      expect(safeCompare('tenant:org:123', 'tenant:org:123')).toBe(true);
      expect(safeCompare('user@example.com', 'user@other.com')).toBe(false);
    });

    it('should handle unicode characters', () => {
      expect(safeCompare('用户123', '用户123')).toBe(true);
      expect(safeCompare('用户123', '用户456')).toBe(false);
      expect(safeCompare('🔐key', '🔐key')).toBe(true);
      expect(safeCompare('🔐key', '🔑key')).toBe(false);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      expect(safeCompare(longString, longString)).toBe(true);
      expect(safeCompare(longString, longString + 'b')).toBe(false);
      expect(safeCompare(longString, 'a'.repeat(9999))).toBe(false);
    });

    it('should handle non-string inputs gracefully', () => {
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(safeCompare(123, 123)).toBe(false);
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(safeCompare(null, null)).toBe(false);
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(safeCompare(undefined, undefined)).toBe(false);
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(safeCompare({}, {})).toBe(false);
      // @ts-expect-error - testing runtime behavior with invalid input
      expect(safeCompare('string', 123)).toBe(false);
    });

    it('should be consistent (no timing variance for wrong chars at different positions)', () => {
      // While we can't directly test timing safety in Jest, we can verify consistency
      const base = 'secret-user-id-123456789';

      // Wrong char at beginning
      expect(safeCompare(base, 'Xecret-user-id-123456789')).toBe(false);
      // Wrong char in middle
      expect(safeCompare(base, 'secret-user-Xd-123456789')).toBe(false);
      // Wrong char at end
      expect(safeCompare(base, 'secret-user-id-12345678X')).toBe(false);

      // All should return false the same way regardless of position
    });

    describe('real-world use cases', () => {
      it('should safely compare user IDs', () => {
        const validUserId = 'usr_c3VwZXJzZWNyZXQ';
        const attackerGuess1 = 'usr_c3VwZXJzZWNyZXQ'; // Same
        const attackerGuess2 = 'usr_YXR0YWNrZXI'; // Different

        expect(safeCompare(validUserId, attackerGuess1)).toBe(true);
        expect(safeCompare(validUserId, attackerGuess2)).toBe(false);
      });

      it('should safely compare tenant IDs', () => {
        const tenantId = 'tenant_acme_corp_12345';
        expect(safeCompare(tenantId, 'tenant_acme_corp_12345')).toBe(true);
        expect(safeCompare(tenantId, 'tenant_evil_corp_12345')).toBe(false);
      });

      it('should safely compare API keys', () => {
        const apiKey = 'sk_live_abcdef123456789';
        expect(safeCompare(apiKey, 'sk_live_abcdef123456789')).toBe(true);
        expect(safeCompare(apiKey, 'sk_test_abcdef123456789')).toBe(false);
      });

      it('should safely compare session tokens', () => {
        const sessionToken = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.signature';
        expect(safeCompare(sessionToken, sessionToken)).toBe(true);
        expect(safeCompare(sessionToken, 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiI0NTYifQ.different')).toBe(false);
      });
    });
  });
});
