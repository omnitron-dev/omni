import { describe, it, expect, beforeEach } from '@jest/globals';
import { WildcardMatcher } from '../src/wildcard';

describe('WildcardMatcher', () => {
  let matcher: WildcardMatcher;

  beforeEach(() => {
    matcher = new WildcardMatcher();
  });

  describe('isWildcard', () => {
    it('should detect wildcard patterns', () => {
      expect(matcher.isWildcard('user.*')).toBe(true);
      expect(matcher.isWildcard('user.**')).toBe(true);
      expect(matcher.isWildcard('*.created')).toBe(true);
      expect(matcher.isWildcard('app.*.error')).toBe(true);
      expect(matcher.isWildcard('user.created')).toBe(false);
      expect(matcher.isWildcard('simple.event')).toBe(false);
    });
  });

  describe('match', () => {
    describe('exact matching', () => {
      it('should match exact event names', () => {
        expect(matcher.match('user.created', 'user.created')).toBe(true);
        expect(matcher.match('user.created', 'user.updated')).toBe(false);
      });
    });

    describe('single wildcard (*)', () => {
      it('should match single segment wildcards', () => {
        expect(matcher.match('user.created', 'user.*')).toBe(true);
        expect(matcher.match('user.updated', 'user.*')).toBe(true);
        expect(matcher.match('user.profile.updated', 'user.*')).toBe(false);

        expect(matcher.match('user.created', '*.created')).toBe(true);
        expect(matcher.match('post.created', '*.created')).toBe(true);
        expect(matcher.match('created', '*.created')).toBe(false);

        expect(matcher.match('app.db.error', 'app.*.error')).toBe(true);
        expect(matcher.match('app.api.error', 'app.*.error')).toBe(true);
        expect(matcher.match('app.error', 'app.*.error')).toBe(false);
        expect(matcher.match('app.db.api.error', 'app.*.error')).toBe(false);
      });

      it('should match partial wildcards', () => {
        expect(matcher.match('userService', 'user*')).toBe(true);
        expect(matcher.match('userController', 'user*')).toBe(true);
        expect(matcher.match('user', 'user*')).toBe(true);
        expect(matcher.match('adminService', 'user*')).toBe(false);

        expect(matcher.match('userService', '*Service')).toBe(true);
        expect(matcher.match('adminService', '*Service')).toBe(true);
        expect(matcher.match('Service', '*Service')).toBe(true);
        expect(matcher.match('userController', '*Service')).toBe(false);

        expect(matcher.match('userService', 'user*Service')).toBe(true);
        expect(matcher.match('userAuthService', 'user*Service')).toBe(true);
        expect(matcher.match('adminService', 'user*Service')).toBe(false);
      });
    });

    describe('globstar (**)', () => {
      it('should match zero or more segments', () => {
        expect(matcher.match('user', 'user.**')).toBe(true);
        expect(matcher.match('user.created', 'user.**')).toBe(true);
        expect(matcher.match('user.profile.updated', 'user.**')).toBe(true);
        expect(matcher.match('user.profile.settings.changed', 'user.**')).toBe(true);
        expect(matcher.match('admin.created', 'user.**')).toBe(false);
      });

      it('should match globstar at the beginning', () => {
        expect(matcher.match('created', '**.created')).toBe(true);
        expect(matcher.match('user.created', '**.created')).toBe(true);
        expect(matcher.match('app.user.created', '**.created')).toBe(true);
        expect(matcher.match('user.updated', '**.created')).toBe(false);
      });

      it('should match globstar in the middle', () => {
        expect(matcher.match('app.error', 'app.**.error')).toBe(true);
        expect(matcher.match('app.db.error', 'app.**.error')).toBe(true);
        expect(matcher.match('app.db.connection.error', 'app.**.error')).toBe(true);
        expect(matcher.match('app.db.connection.warning', 'app.**.error')).toBe(false);
      });
    });

    describe('complex patterns', () => {
      it('should match combined wildcard patterns', () => {
        expect(matcher.match('app.user.created', 'app.*.*')).toBe(true);
        expect(matcher.match('app.user.profile.created', 'app.*.*')).toBe(false);

        expect(matcher.match('app.db.connection.error', 'app.**.error')).toBe(true);
        expect(matcher.match('app.api.v1.users.error', 'app.**.error')).toBe(true);

        expect(matcher.match('service.user.auth.login', 'service.*.auth.*')).toBe(true);
        expect(matcher.match('service.admin.auth.logout', 'service.*.auth.*')).toBe(true);
        expect(matcher.match('service.user.login', 'service.*.auth.*')).toBe(false);
      });
    });

    describe('custom delimiters', () => {
      it('should work with custom delimiters', () => {
        const customMatcher = new WildcardMatcher('/', '*', '**');

        expect(customMatcher.match('user/created', 'user/*')).toBe(true);
        expect(customMatcher.match('user/profile/updated', 'user/**')).toBe(true);
        expect(customMatcher.match('app/db/error', 'app/*/error')).toBe(true);

        const colonMatcher = new WildcardMatcher(':', '*', '**');
        expect(colonMatcher.match('user:created', 'user:*')).toBe(true);
        expect(colonMatcher.match('user:profile:updated', 'user:**')).toBe(true);
      });
    });
  });

  describe('findMatchingPatterns', () => {
    it('should find all matching patterns for an event', () => {
      const patterns = ['user.created', 'user.*', '*.created', 'user.**', '**.created', 'admin.*', 'post.created'];

      const matches = matcher.findMatchingPatterns('user.created', patterns);
      expect(matches).toEqual(['user.created', 'user.*', '*.created', 'user.**', '**.created']);
    });

    it('should return empty array when no patterns match', () => {
      const patterns = ['admin.*', 'post.*', '*.deleted'];
      const matches = matcher.findMatchingPatterns('user.created', patterns);
      expect(matches).toEqual([]);
    });
  });

  describe('cache management', () => {
    it('should cache compiled patterns', () => {
      // First call compiles the pattern
      matcher.match('user.created', 'user.*');
      const size1 = matcher.getCacheSize();
      expect(size1).toBe(1);

      // Second call uses cached pattern
      matcher.match('user.updated', 'user.*');
      const size2 = matcher.getCacheSize();
      expect(size2).toBe(1); // Same pattern, same cache size

      // Different pattern increases cache
      matcher.match('post.created', 'post.*');
      const size3 = matcher.getCacheSize();
      expect(size3).toBe(2);
    });

    it('should clear cache', () => {
      matcher.match('user.created', 'user.*');
      matcher.match('post.created', 'post.*');
      expect(matcher.getCacheSize()).toBe(2);

      matcher.clearCache();
      expect(matcher.getCacheSize()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings', () => {
      expect(matcher.match('', '')).toBe(true);
      expect(matcher.match('event', '')).toBe(false);
      expect(matcher.match('', 'event')).toBe(false);
    });

    it('should handle patterns with only wildcards', () => {
      expect(matcher.match('anything', '*')).toBe(true);
      expect(matcher.match('any.thing', '*')).toBe(false);
      expect(matcher.match('anything', '**')).toBe(true);
      expect(matcher.match('any.thing.here', '**')).toBe(true);
    });

    it('should handle consecutive delimiters', () => {
      expect(matcher.match('user..created', 'user.*.created')).toBe(true);
      expect(matcher.match('user..created', 'user..created')).toBe(true);
    });

    it('should handle special regex characters in event names', () => {
      expect(matcher.match('user.test[1]', 'user.test[1]')).toBe(true);
      expect(matcher.match('user.$special', 'user.$special')).toBe(true);
      expect(matcher.match('user.(test)', 'user.(test)')).toBe(true);
      expect(matcher.match('user.test+', 'user.test+')).toBe(true);
    });
  });
});
