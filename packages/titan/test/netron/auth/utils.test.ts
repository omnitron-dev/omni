/**
 * Utils Integration Tests
 *
 * Tests for authentication utility functions including
 * extractBearerToken and safeCompare.
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect } from 'vitest';
import {
  createPermissionChecker,
  extractBearerToken,
  hasPermission,
  safeCompare,
} from '../../../src/netron/auth/utils.js';

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

describe('createPermissionChecker', () => {
  // Same semantics as hasPermission, checked against it rather than restated:
  // the indexed form exists only to make an ACL check linear, and a divergence
  // between the two would be an authorization difference, not an optimisation.
  const grants = ['users.read', 'admin.*', '*', 'exact.one', 'billing.write'];

  const cases = [
    'users.read',
    'users.write',
    'admin.users.delete',
    'admin',
    'exact.one',
    'exact.two',
    'billing.write',
    'nothing.at.all',
    '',
  ];

  for (const granted of [grants, grants.filter((g) => g !== '*'), ['users.read'], []]) {
    it(`agrees with hasPermission for grants [${granted.join(', ') || 'none'}]`, () => {
      const permitted = createPermissionChecker(granted);
      for (const required of cases) {
        expect(permitted(required), `disagreed on '${required}'`).toBe(hasPermission(granted, required));
      }
    });
  }

  // The point of `createPermissionChecker` is that an exact grant is answered
  // without consulting the other grants — `hasPermission` in a loop scans the
  // whole array per required permission, a million comparisons for a thousand
  // of each, on the authorization path.
  //
  // This used to be asserted with a stopwatch: build a checker over 100 grants
  // and over 1000, and require the second to cost less than 50x the first. That
  // could not work. The small side is hundredths of a millisecond, so one
  // scheduler slice in the numerator sends the ratio past the threshold — it was
  // measured at 108x during a full monorepo run and 7.6x–14.9x when idle, and
  // raising the iteration count widens the spread rather than narrowing it,
  // because V8 optimises a 100-element walk and a 1000-element walk differently.
  // The ratio is not a stable quantity at any scale, so no threshold over it
  // means anything. `Math.max(small, 0.001)` made it worse rather than safer:
  // the author saw the denominator could collapse and clamped its SHAPE, which
  // lets pure noise stand in for a measurement.
  //
  // The property underneath is not temporal at all, and is checked directly
  // below: an exact hit must not touch the other grants.
  it('answers an exact grant without consulting the other grants', () => {
    let touchedAfterBuild = 0;
    let built = false;

    // Poses as a wildcard grant so it lands in the list `permissionMatches`
    // walks, and counts every look it gets once construction is over.
    const poison = {
      endsWith: (suffix: string) => {
        if (built) touchedAfterBuild++;
        return suffix === '.*';
      },
      slice: () => 'never.matches.',
    } as unknown as string;

    // FIRST in the array on purpose: a linear scan would have to walk past it to
    // reach the exact grant below. Placed last, it survived a mutation that
    // restored the scan — `some()` short-circuited on the match before ever
    // reaching it, and the test passed while measuring nothing.
    const permitted = createPermissionChecker([
      poison,
      ...Array.from({ length: 1000 }, (_, i) => `perm:${i}`),
    ]);
    built = true;

    expect(permitted('perm:999')).toBe(true);
    expect(touchedAfterBuild, 'an exact grant walked the wildcard list').toBe(0);

    // Control: the counter can move, so the zero above is an observation and
    // not an artefact of a poison nothing ever reaches.
    expect(permitted('granted.to.nobody')).toBe(false);
    expect(touchedAfterBuild, 'a miss did not consult the wildcards either').toBeGreaterThan(0);
  });

  it('answers from the grants it was given, not from later edits to the array', () => {
    const grants = ['users.read'];
    const permitted = createPermissionChecker(grants);

    grants.push('admin');
    grants.length = 0;

    // The checker took a snapshot; a caller mutating its own array afterwards
    // must not change an authorization decision that was already built.
    expect(permitted('users.read')).toBe(true);
    expect(permitted('admin')).toBe(false);
  });
});
