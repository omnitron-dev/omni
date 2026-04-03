/**
 * Unit tests for Cache Invalidation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CORE_TASK_INVALIDATE_CACHE,
  createInvalidateCacheRequest,
  isInvalidateCacheResponse,
  matchesPattern,
  type InvalidateCacheRequest,
  type InvalidateCacheResponse,
} from '../../src/core-tasks/invalidate-cache.js';

describe('Cache Invalidation Core Task', () => {
  describe('Constants', () => {
    it('should export the correct task name', () => {
      expect(CORE_TASK_INVALIDATE_CACHE).toBe('netron.invalidate_cache');
    });
  });

  describe('createInvalidateCacheRequest', () => {
    it('should create request with no pattern (clear all)', () => {
      const request = createInvalidateCacheRequest();
      expect(request).toEqual({
        pattern: undefined,
        cacheType: 'all',
      });
    });

    it('should create request with specific pattern', () => {
      const request = createInvalidateCacheRequest('UserService@1.0.0');
      expect(request).toEqual({
        pattern: 'UserService@1.0.0',
        cacheType: 'all',
      });
    });

    it('should create request with wildcard pattern', () => {
      const request = createInvalidateCacheRequest('User*');
      expect(request).toEqual({
        pattern: 'User*',
        cacheType: 'all',
      });
    });

    it('should create request with service cache type', () => {
      const request = createInvalidateCacheRequest(undefined, 'service');
      expect(request).toEqual({
        pattern: undefined,
        cacheType: 'service',
      });
    });

    it('should create request with http cache type', () => {
      const request = createInvalidateCacheRequest('User*', 'http');
      expect(request).toEqual({
        pattern: 'User*',
        cacheType: 'http',
      });
    });
  });

  describe('isInvalidateCacheResponse', () => {
    it('should validate correct response', () => {
      const response: InvalidateCacheResponse = {
        count: 5,
      };
      expect(isInvalidateCacheResponse(response)).toBe(true);
    });

    it('should validate response with breakdown', () => {
      const response: InvalidateCacheResponse = {
        count: 10,
        breakdown: {
          service: 5,
          http: 5,
        },
      };
      expect(isInvalidateCacheResponse(response)).toBe(true);
    });

    it('should reject invalid response (missing count)', () => {
      const response = { breakdown: { service: 5 } };
      expect(isInvalidateCacheResponse(response)).toBe(false);
    });

    it('should reject invalid response (wrong count type)', () => {
      const response = { count: '5' };
      expect(isInvalidateCacheResponse(response)).toBe(false);
    });

    it('should reject null', () => {
      expect(isInvalidateCacheResponse(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isInvalidateCacheResponse(undefined)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(isInvalidateCacheResponse(42)).toBe(false);
      expect(isInvalidateCacheResponse('string')).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    describe('exact match', () => {
      it('should match exact service name', () => {
        expect(matchesPattern('UserService@1.0.0', 'UserService@1.0.0')).toBe(true);
      });

      it('should not match different service name', () => {
        expect(matchesPattern('UserService@1.0.0', 'OrderService@1.0.0')).toBe(false);
      });
    });

    describe('wildcard patterns', () => {
      it('should match prefix wildcard', () => {
        expect(matchesPattern('UserService@1.0.0', 'User*')).toBe(true);
        expect(matchesPattern('UserAuthService@1.0.0', 'User*')).toBe(true);
      });

      it('should not match non-matching prefix', () => {
        expect(matchesPattern('OrderService@1.0.0', 'User*')).toBe(false);
      });

      it('should match suffix wildcard', () => {
        expect(matchesPattern('UserService@1.0.0', '*@1.0.0')).toBe(true);
        expect(matchesPattern('OrderService@1.0.0', '*@1.0.0')).toBe(true);
      });

      it('should not match non-matching suffix', () => {
        expect(matchesPattern('UserService@2.0.0', '*@1.0.0')).toBe(false);
      });

      it('should match middle wildcard', () => {
        expect(matchesPattern('UserService@1.0.0', 'User*@1.0.0')).toBe(true);
        expect(matchesPattern('UserAuthService@1.0.0', 'User*@1.0.0')).toBe(true);
      });

      it('should match multiple wildcards', () => {
        expect(matchesPattern('UserService@1.0.0', 'User*Service*')).toBe(true);
        expect(matchesPattern('UserAuthService@1.0.0', 'User*Service*')).toBe(true);
      });

      it('should match everything with single wildcard', () => {
        expect(matchesPattern('UserService@1.0.0', '*')).toBe(true);
        expect(matchesPattern('OrderService@2.0.0', '*')).toBe(true);
        expect(matchesPattern('anything', '*')).toBe(true);
      });
    });

    describe('special characters escaping', () => {
      it('should escape regex special characters', () => {
        expect(matchesPattern('User.Service@1.0.0', 'User.Service@1.0.0')).toBe(true);
        expect(matchesPattern('User+Service@1.0.0', 'User+Service@1.0.0')).toBe(true);
        expect(matchesPattern('User[Service]@1.0.0', 'User[Service]@1.0.0')).toBe(true);
      });

      it('should handle parentheses', () => {
        expect(matchesPattern('User(Service)@1.0.0', 'User(Service)@1.0.0')).toBe(true);
      });

      it('should handle dollar sign', () => {
        expect(matchesPattern('User$Service@1.0.0', 'User$Service@1.0.0')).toBe(true);
      });

      it('should handle caret', () => {
        expect(matchesPattern('User^Service@1.0.0', 'User^Service@1.0.0')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should match empty string', () => {
        expect(matchesPattern('', '')).toBe(true);
      });

      it('should not match empty pattern to non-empty string', () => {
        expect(matchesPattern('UserService', '')).toBe(false);
      });

      it('should match single character', () => {
        expect(matchesPattern('U', 'U')).toBe(true);
      });

      it('should handle wildcard at start', () => {
        expect(matchesPattern('UserService', '*Service')).toBe(true);
      });

      it('should handle wildcard at end', () => {
        expect(matchesPattern('UserService', 'User*')).toBe(true);
      });

      it('should handle wildcard only', () => {
        expect(matchesPattern('anything', '*')).toBe(true);
      });
    });

    describe('case sensitivity', () => {
      it('should be case sensitive', () => {
        expect(matchesPattern('UserService', 'userservice')).toBe(false);
        expect(matchesPattern('UserService', 'UserService')).toBe(true);
      });

      it('should handle case sensitive wildcards', () => {
        expect(matchesPattern('UserService', 'user*')).toBe(false);
        expect(matchesPattern('UserService', 'User*')).toBe(true);
      });
    });

    describe('version patterns', () => {
      it('should match version wildcards', () => {
        expect(matchesPattern('UserService@1.0.0', '*@1.0.0')).toBe(true);
        expect(matchesPattern('UserService@1.2.3', 'UserService@1.*')).toBe(true);
        expect(matchesPattern('UserService@1.2.3', 'UserService@*.*.3')).toBe(true);
      });

      it('should not match different versions', () => {
        expect(matchesPattern('UserService@1.0.0', 'UserService@2.0.0')).toBe(false);
      });
    });

    describe('complex patterns', () => {
      it('should match complex service patterns', () => {
        expect(matchesPattern('com.example.UserService@1.0.0', 'com.example.*@1.0.0')).toBe(true);
        expect(matchesPattern('com.example.UserService@1.0.0', '*.UserService@*')).toBe(true);
        expect(matchesPattern('com.example.UserService@1.0.0', 'com.*.*@1.0.0')).toBe(true);
      });

      it('should not match non-matching complex patterns', () => {
        expect(matchesPattern('com.example.UserService@1.0.0', 'org.example.*@1.0.0')).toBe(false);
      });
    });
  });
});

describe('InvalidateCacheRequest Type', () => {
  it('should allow valid request types', () => {
    const request1: InvalidateCacheRequest = {
      pattern: 'UserService@1.0.0',
      cacheType: 'service',
    };

    const request2: InvalidateCacheRequest = {
      pattern: undefined,
      cacheType: 'http',
    };

    const request3: InvalidateCacheRequest = {
      pattern: 'User*',
      cacheType: 'all',
    };

    expect(request1).toBeDefined();
    expect(request2).toBeDefined();
    expect(request3).toBeDefined();
  });
});

describe('InvalidateCacheResponse Type', () => {
  it('should allow valid response types', () => {
    const response1: InvalidateCacheResponse = {
      count: 5,
    };

    const response2: InvalidateCacheResponse = {
      count: 10,
      breakdown: {
        service: 5,
        http: 5,
      },
    };

    const response3: InvalidateCacheResponse = {
      count: 0,
      breakdown: {},
    };

    expect(response1).toBeDefined();
    expect(response2).toBeDefined();
    expect(response3).toBeDefined();
  });
});
