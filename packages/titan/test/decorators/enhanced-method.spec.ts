/**
 * Tests for enhanced @Method decorator with auth, rateLimit, cache, prefetch, audit
 */

import { describe, it, expect } from '@jest/globals';
import { Method, METADATA_KEYS } from '../../src/decorators/core.js';
import type { MethodOptions } from '../../src/netron/auth/types.js';

describe('Enhanced @Method Decorator', () => {
  describe('Backward Compatibility', () => {
    it('should work without options (legacy behavior)', () => {
      class TestService {
        @Method()
        testMethod() {
          return 'test';
        }
      }

      const isPublic = Reflect.getMetadata('public', TestService.prototype, 'testMethod');
      const isMethod = Reflect.getMetadata(
        METADATA_KEYS.METHOD_ANNOTATION,
        TestService.prototype,
        'testMethod',
      );

      expect(isPublic).toBe(true);
      expect(isMethod).toBe(true);
    });

    it('should support readonly option for properties', () => {
      class TestService {
        @Method({ readonly: true })
        readonly value: string = 'test';
      }

      const readonly = Reflect.getMetadata('readonly', TestService.prototype, 'value');
      expect(readonly).toBe(true);
    });

    it('should support transports option (legacy)', () => {
      class TestService {
        @Method({ transports: ['ws', 'tcp'] })
        wsAndTcpMethod() {
          return 'test';
        }
      }

      const transports = Reflect.getMetadata(
        'method:transports',
        TestService.prototype,
        'wsAndTcpMethod',
      );
      expect(transports).toEqual(['ws', 'tcp']);
    });
  });

  describe('Auth Configuration', () => {
    it('should store simple auth: true', () => {
      class TestService {
        @Method({ auth: true })
        protectedMethod() {
          return 'protected';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'protectedMethod',
      );
      expect(authConfig).toBe(true);
    });

    it('should store auth with roles', () => {
      class TestService {
        @Method({
          auth: {
            roles: ['admin', 'user'],
          },
        })
        adminMethod() {
          return 'admin only';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'adminMethod',
      );
      expect(authConfig).toEqual({
        roles: ['admin', 'user'],
      });
    });

    it('should store auth with permissions', () => {
      class TestService {
        @Method({
          auth: {
            permissions: ['user:read', 'user:write'],
          },
        })
        userMethod() {
          return 'user method';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'userMethod',
      );
      expect(authConfig).toEqual({
        permissions: ['user:read', 'user:write'],
      });
    });

    it('should store auth with OAuth2 scopes', () => {
      class TestService {
        @Method({
          auth: {
            scopes: ['read:documents', 'write:documents'],
          },
        })
        documentMethod() {
          return 'document method';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'documentMethod',
      );
      expect(authConfig).toEqual({
        scopes: ['read:documents', 'write:documents'],
      });
    });

    it('should store auth with policies array', () => {
      class TestService {
        @Method({
          auth: {
            policies: ['policy1', 'policy2'],
          },
        })
        policyMethod() {
          return 'policy method';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'policyMethod',
      );
      expect(authConfig).toEqual({
        policies: ['policy1', 'policy2'],
      });
    });

    it('should store auth with policy expressions (all)', () => {
      class TestService {
        @Method({
          auth: {
            policies: { all: ['policy1', 'policy2'] },
          },
        })
        allPoliciesMethod() {
          return 'all policies';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'allPoliciesMethod',
      );
      expect(authConfig).toEqual({
        policies: { all: ['policy1', 'policy2'] },
      });
    });

    it('should store auth with policy expressions (any)', () => {
      class TestService {
        @Method({
          auth: {
            policies: { any: ['resource:owner', 'role:admin'] },
          },
        })
        anyPolicyMethod() {
          return 'any policy';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'anyPolicyMethod',
      );
      expect(authConfig).toEqual({
        policies: { any: ['resource:owner', 'role:admin'] },
      });
    });

    it('should store auth with allowAnonymous', () => {
      class TestService {
        @Method({
          auth: {
            allowAnonymous: true,
          },
        })
        publicMethod() {
          return 'public';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'publicMethod',
      );
      expect(authConfig).toEqual({
        allowAnonymous: true,
      });
    });

    it('should store auth with inherit and override flags', () => {
      class TestService {
        @Method({
          auth: {
            roles: ['user'],
            inherit: true,
          },
        })
        inheritMethod() {
          return 'inherit';
        }

        @Method({
          auth: {
            allowAnonymous: true,
            override: true,
          },
        })
        overrideMethod() {
          return 'override';
        }
      }

      const inheritAuth = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'inheritMethod',
      );
      const overrideAuth = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'overrideMethod',
      );

      expect(inheritAuth).toEqual({
        roles: ['user'],
        inherit: true,
      });
      expect(overrideAuth).toEqual({
        allowAnonymous: true,
        override: true,
      });
    });

    it('should store complex auth configuration', () => {
      class TestService {
        @Method({
          auth: {
            roles: ['user'],
            scopes: ['write:documents'],
            policies: { any: ['resource:owner', 'role:admin'] },
            inherit: true,
          },
        })
        complexAuthMethod() {
          return 'complex';
        }
      }

      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'complexAuthMethod',
      );
      expect(authConfig).toEqual({
        roles: ['user'],
        scopes: ['write:documents'],
        policies: { any: ['resource:owner', 'role:admin'] },
        inherit: true,
      });
    });
  });

  describe('Rate Limit Configuration', () => {
    it('should store simple rate limit', () => {
      class TestService {
        @Method({
          rateLimit: {
            maxRequests: 100,
            windowMs: 60000,
          },
        })
        rateLimitedMethod() {
          return 'rate limited';
        }
      }

      const rateLimitConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_RATE_LIMIT,
        TestService.prototype,
        'rateLimitedMethod',
      );
      expect(rateLimitConfig).toEqual({
        maxRequests: 100,
        windowMs: 60000,
      });
    });

    it('should store tiered rate limit', () => {
      class TestService {
        @Method({
          rateLimit: {
            defaultTier: { name: 'free', limit: 10, burst: 20 },
            tiers: {
              premium: { name: 'premium', limit: 100, burst: 150, priority: 10 },
              enterprise: { name: 'enterprise', limit: 1000, burst: 1500, priority: 20 },
            },
            window: 60000,
            queue: true,
            maxQueueSize: 100,
          },
        })
        tieredRateLimitMethod() {
          return 'tiered';
        }
      }

      const rateLimitConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_RATE_LIMIT,
        TestService.prototype,
        'tieredRateLimitMethod',
      );
      expect(rateLimitConfig.defaultTier).toEqual({ name: 'free', limit: 10, burst: 20 });
      expect(rateLimitConfig.tiers.premium).toEqual({
        name: 'premium',
        limit: 100,
        burst: 150,
        priority: 10,
      });
      expect(rateLimitConfig.queue).toBe(true);
      expect(rateLimitConfig.maxQueueSize).toBe(100);
    });
  });

  describe('Cache Configuration', () => {
    it('should store cache configuration', () => {
      class TestService {
        @Method({
          cache: {
            ttl: 30000,
            invalidateOn: ['document:updated', 'document:deleted'],
          },
        })
        cachedMethod() {
          return 'cached';
        }
      }

      const cacheConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_CACHE,
        TestService.prototype,
        'cachedMethod',
      );
      expect(cacheConfig).toEqual({
        ttl: 30000,
        invalidateOn: ['document:updated', 'document:deleted'],
      });
    });

    it('should store cache with custom key generator', () => {
      const keyGen = (args: any[]) => `custom:${args[0]}`;

      class TestService {
        @Method({
          cache: {
            ttl: 60000,
            keyGenerator: keyGen,
            maxSize: 1000,
          },
        })
        customCacheMethod(id: string) {
          return `result:${id}`;
        }
      }

      const cacheConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_CACHE,
        TestService.prototype,
        'customCacheMethod',
      );
      expect(cacheConfig.ttl).toBe(60000);
      expect(cacheConfig.keyGenerator).toBe(keyGen);
      expect(cacheConfig.maxSize).toBe(1000);
    });
  });

  describe('Prefetch Configuration', () => {
    it('should store prefetch configuration', () => {
      class TestService {
        @Method({
          prefetch: {
            enabled: true,
            cacheTTL: 60000,
          },
        })
        prefetchMethod() {
          return 'prefetch';
        }
      }

      const prefetchConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_PREFETCH,
        TestService.prototype,
        'prefetchMethod',
      );
      expect(prefetchConfig).toEqual({
        enabled: true,
        cacheTTL: 60000,
      });
    });

    it('should store prefetch with custom fetcher', () => {
      const fetcher = async (ids: string[]) => new Map();

      class TestService {
        @Method({
          prefetch: {
            enabled: true,
            fetcher,
            cacheTTL: 30000,
          },
        })
        customPrefetchMethod() {
          return 'custom prefetch';
        }
      }

      const prefetchConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_PREFETCH,
        TestService.prototype,
        'customPrefetchMethod',
      );
      expect(prefetchConfig.enabled).toBe(true);
      expect(prefetchConfig.fetcher).toBe(fetcher);
      expect(prefetchConfig.cacheTTL).toBe(30000);
    });
  });

  describe('Audit Configuration', () => {
    it('should store audit configuration', () => {
      class TestService {
        @Method({
          audit: {
            includeArgs: true,
            includeResult: true,
            includeUser: true,
          },
        })
        auditedMethod() {
          return 'audited';
        }
      }

      const auditConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUDIT,
        TestService.prototype,
        'auditedMethod',
      );
      expect(auditConfig).toEqual({
        includeArgs: true,
        includeResult: true,
        includeUser: true,
      });
    });

    it('should store audit with custom logger', () => {
      const customLogger = (event: any) => console.log(event);

      class TestService {
        @Method({
          audit: {
            includeArgs: true,
            logger: customLogger,
          },
        })
        customAuditMethod() {
          return 'custom audit';
        }
      }

      const auditConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUDIT,
        TestService.prototype,
        'customAuditMethod',
      );
      expect(auditConfig.includeArgs).toBe(true);
      expect(auditConfig.logger).toBe(customLogger);
    });
  });

  describe('Combined Options', () => {
    it('should store all options together', () => {
      class TestService {
        @Method({
          transports: ['ws'],
          auth: {
            roles: ['user'],
            scopes: ['write:documents'],
            policies: { any: ['resource:owner', 'role:admin'] },
          },
          rateLimit: {
            maxRequests: 100,
            windowMs: 60000,
          },
          cache: {
            ttl: 30000,
            invalidateOn: ['document:updated'],
          },
          prefetch: {
            enabled: true,
          },
          audit: {
            includeArgs: true,
            includeResult: true,
          },
        })
        fullFeaturedMethod(id: string) {
          return `full:${id}`;
        }
      }

      const transports = Reflect.getMetadata(
        'method:transports',
        TestService.prototype,
        'fullFeaturedMethod',
      );
      const authConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUTH,
        TestService.prototype,
        'fullFeaturedMethod',
      );
      const rateLimitConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_RATE_LIMIT,
        TestService.prototype,
        'fullFeaturedMethod',
      );
      const cacheConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_CACHE,
        TestService.prototype,
        'fullFeaturedMethod',
      );
      const prefetchConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_PREFETCH,
        TestService.prototype,
        'fullFeaturedMethod',
      );
      const auditConfig = Reflect.getMetadata(
        METADATA_KEYS.METHOD_AUDIT,
        TestService.prototype,
        'fullFeaturedMethod',
      );
      const methodOptions = Reflect.getMetadata(
        METADATA_KEYS.METHOD_OPTIONS,
        TestService.prototype,
        'fullFeaturedMethod',
      );

      expect(transports).toEqual(['ws']);
      expect(authConfig.roles).toEqual(['user']);
      expect(rateLimitConfig.maxRequests).toBe(100);
      expect(cacheConfig.ttl).toBe(30000);
      expect(prefetchConfig.enabled).toBe(true);
      expect(auditConfig.includeArgs).toBe(true);
      expect(methodOptions).toBeDefined();
      expect(methodOptions.auth).toBeDefined();
      expect(methodOptions.rateLimit).toBeDefined();
      expect(methodOptions.cache).toBeDefined();
      expect(methodOptions.prefetch).toBeDefined();
      expect(methodOptions.audit).toBeDefined();
    });
  });

  describe('METHOD_OPTIONS Metadata', () => {
    it('should store complete options object', () => {
      const options: MethodOptions = {
        auth: {
          roles: ['admin'],
        },
        rateLimit: {
          maxRequests: 50,
          windowMs: 60000,
        },
      };

      class TestService {
        @Method(options)
        testMethod() {
          return 'test';
        }
      }

      const storedOptions = Reflect.getMetadata(
        METADATA_KEYS.METHOD_OPTIONS,
        TestService.prototype,
        'testMethod',
      );

      expect(storedOptions).toEqual(options);
    });
  });
});
