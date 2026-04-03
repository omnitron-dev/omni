/**
 * Unit tests for ServiceRouter
 *
 * Tests the service routing functionality for multi-backend client,
 * including explicit mappings, pattern matching, and default fallback.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceRouter } from '../../../src/routing/service-router.js';
import type { RoutingConfig } from '../../../src/types/multi-backend.js';

describe('ServiceRouter', () => {
  describe('constructor', () => {
    it('should create router with empty config', () => {
      const router = new ServiceRouter({}, 'default');

      expect(router.getDefaultBackend()).toBe('default');
      expect(router.getConfig()).toEqual({});
    });

    it('should create router with full routing config', () => {
      const config: RoutingConfig = {
        services: { UserService: 'core' },
        patterns: [{ pattern: /^storage\./, backend: 'storage' }],
      };
      const router = new ServiceRouter(config, 'default', ['core', 'storage', 'default']);

      expect(router.getDefaultBackend()).toBe('default');
      expect(router.getConfig()).toEqual(config);
    });

    it('should accept available backends for validation', () => {
      const router = new ServiceRouter({}, 'default', ['core', 'storage', 'default']);

      expect(router.isBackendAvailable('core')).toBe(true);
      expect(router.isBackendAvailable('storage')).toBe(true);
      expect(router.isBackendAvailable('unknown')).toBe(false);
    });
  });

  describe('resolve - explicit service mapping', () => {
    let router: ServiceRouter;

    beforeEach(() => {
      const config: RoutingConfig = {
        services: {
          UserService: 'core',
          FileService: 'storage',
          AuthService: 'auth',
        },
      };
      router = new ServiceRouter(config, 'default', ['core', 'storage', 'auth', 'default']);
    });

    it('should resolve by explicit service mapping (highest priority)', () => {
      expect(router.resolve('UserService')).toBe('core');
      expect(router.resolve('FileService')).toBe('storage');
      expect(router.resolve('AuthService')).toBe('auth');
    });

    it('should prefer explicit mapping over pattern matching', () => {
      // Use a service name that doesn't have a backend prefix format to test explicit vs pattern
      const config: RoutingConfig = {
        services: { SpecialStorageService: 'core' },
        patterns: [{ pattern: /Storage/, backend: 'storage' }],
      };
      const specialRouter = new ServiceRouter(config, 'default', ['core', 'storage', 'default']);

      // Explicit mapping takes precedence over pattern
      expect(specialRouter.resolve('SpecialStorageService')).toBe('core');
      // Pattern matching for non-explicit services
      expect(specialRouter.resolve('RegularStorageService')).toBe('storage');
    });
  });

  describe('resolve - pattern matching', () => {
    let router: ServiceRouter;

    beforeEach(() => {
      const config: RoutingConfig = {
        patterns: [
          { pattern: /^storage\./, backend: 'storage' },
          { pattern: /^analytics\./, backend: 'analytics' },
          { pattern: /Service$/, backend: 'core' },
        ],
      };
      router = new ServiceRouter(config, 'default', ['core', 'storage', 'analytics', 'default']);
    });

    it('should resolve by RegExp pattern matching', () => {
      expect(router.resolve('storage.files')).toBe('storage');
      expect(router.resolve('storage.blobs')).toBe('storage');
      expect(router.resolve('analytics.events')).toBe('analytics');
      expect(router.resolve('analytics.metrics')).toBe('analytics');
    });

    it('should respect pattern order (first match wins)', () => {
      // 'UserService' matches /Service$/ pattern -> routes to 'core'
      expect(router.resolve('UserService')).toBe('core');
      expect(router.resolve('AuthService')).toBe('core');
    });

    it('should fall back to default for non-matching patterns', () => {
      expect(router.resolve('RandomThing')).toBe('default');
      expect(router.resolve('unknown')).toBe('default');
    });
  });

  describe('resolve - string prefix pattern', () => {
    let router: ServiceRouter;

    beforeEach(() => {
      const config: RoutingConfig = {
        patterns: [
          { pattern: 'storage', backend: 'storage' },
          { pattern: 'api.v1', backend: 'core' },
          { pattern: 'exact-match', backend: 'exact' },
        ],
      };
      router = new ServiceRouter(config, 'default', ['core', 'storage', 'exact', 'default']);
    });

    it('should resolve by string prefix pattern', () => {
      // 'storage' prefix matches services starting with 'storage'
      expect(router.resolve('storage.files')).toBe('storage');
      expect(router.resolve('storageManager')).toBe('storage');
    });

    it('should resolve by string prefix with dot separator', () => {
      expect(router.resolve('api.v1.users')).toBe('core');
      expect(router.resolve('api.v1.auth')).toBe('core');
    });

    it('should handle exact string match', () => {
      expect(router.resolve('exact-match')).toBe('exact');
    });
  });

  describe('resolve - default backend fallback', () => {
    it('should fall back to default backend for unmatched services', () => {
      const router = new ServiceRouter(
        {
          services: { KnownService: 'core' },
          patterns: [{ pattern: /^api\./, backend: 'api' }],
        },
        'fallback',
        ['core', 'api', 'fallback']
      );

      expect(router.resolve('UnknownService')).toBe('fallback');
      expect(router.resolve('random.thing')).toBe('fallback');
      expect(router.resolve('')).toBe('fallback');
    });
  });

  describe('resolve - namespaced service names', () => {
    let router: ServiceRouter;

    beforeEach(() => {
      router = new ServiceRouter({}, 'default', ['core', 'storage', 'analytics', 'default']);
    });

    it('should parse namespaced service names (backend.service)', () => {
      // When service name is qualified with backend prefix
      expect(router.resolve('core.users')).toBe('core');
      expect(router.resolve('storage.files')).toBe('storage');
      expect(router.resolve('analytics.events')).toBe('analytics');
    });

    it('should extract service name from qualified name', () => {
      expect(router.getServiceName('core.users')).toBe('users');
      expect(router.getServiceName('storage.files')).toBe('files');
      expect(router.getServiceName('core.auth.user')).toBe('auth.user');
    });

    it('should handle multi-part service names with backend prefix', () => {
      // 'core.auth.user' -> backend: 'core', service: 'auth.user'
      const parsed = router.parseServiceName('core.auth.user');
      expect(parsed.backend).toBe('core');
      expect(parsed.service).toBe('auth.user');
    });

    it('should handle non-qualified names', () => {
      const parsed = router.parseServiceName('users');
      expect(parsed.backend).toBeUndefined();
      expect(parsed.service).toBe('users');
    });

    it('should use default for unknown backend in qualified name', () => {
      // 'unknown.service' - 'unknown' is not in available backends
      // This will be treated as a normal service name and fall back to default
      const result = router.resolve('unknown.service');
      expect(result).toBe('default');
    });
  });

  describe('empty routing config', () => {
    it('should handle empty routing config gracefully', () => {
      const router = new ServiceRouter({}, 'default');

      // Everything should route to default
      expect(router.resolve('any.service')).toBe('default');
      expect(router.resolve('AnyService')).toBe('default');
      expect(router.resolve('')).toBe('default');
    });

    it('should handle undefined patterns and services', () => {
      const config: RoutingConfig = {};
      const router = new ServiceRouter(config, 'default');

      expect(router.resolve('test')).toBe('default');
    });
  });

  describe('invalid/unknown services', () => {
    it('should handle empty service name gracefully', () => {
      const router = new ServiceRouter({}, 'default');
      expect(router.resolve('')).toBe('default');
    });

    it('should handle service names with special characters', () => {
      const config: RoutingConfig = {
        services: { 'service-with-dashes': 'core' },
        patterns: [{ pattern: /^special_/, backend: 'special' }],
      };
      const router = new ServiceRouter(config, 'default');

      expect(router.resolve('service-with-dashes')).toBe('core');
      expect(router.resolve('special_service')).toBe('special');
    });

    it('should handle very long service names', () => {
      const router = new ServiceRouter({}, 'default');
      const longName = 'a'.repeat(1000);
      expect(router.resolve(longName)).toBe('default');
    });
  });

  describe('addServiceMapping', () => {
    it('should add explicit service mapping', () => {
      const router = new ServiceRouter({}, 'default');

      router.addServiceMapping('NewService', 'core');

      expect(router.resolve('NewService')).toBe('core');
    });

    it('should initialize services object if not exists', () => {
      const router = new ServiceRouter({}, 'default');

      expect(router.getConfig().services).toBeUndefined();

      router.addServiceMapping('NewService', 'core');

      expect(router.getConfig().services).toBeDefined();
      expect(router.getConfig().services!['NewService']).toBe('core');
    });
  });

  describe('removeServiceMapping', () => {
    it('should remove explicit service mapping', () => {
      const router = new ServiceRouter({ services: { TestService: 'core' } }, 'default');

      expect(router.resolve('TestService')).toBe('core');

      const removed = router.removeServiceMapping('TestService');

      expect(removed).toBe(true);
      expect(router.resolve('TestService')).toBe('default');
    });

    it('should return false for non-existent mapping', () => {
      const router = new ServiceRouter({}, 'default');

      const removed = router.removeServiceMapping('NonExistent');

      expect(removed).toBe(false);
    });
  });

  describe('addPattern', () => {
    it('should add routing pattern', () => {
      const router = new ServiceRouter({}, 'default');

      router.addPattern(/^new\./, 'newBackend');

      expect(router.resolve('new.service')).toBe('newBackend');
    });

    it('should initialize patterns array if not exists', () => {
      const router = new ServiceRouter({}, 'default');

      expect(router.getConfig().patterns).toBeUndefined();

      router.addPattern('prefix', 'backend');

      expect(router.getConfig().patterns).toBeDefined();
      expect(router.getConfig().patterns!.length).toBe(1);
    });
  });

  describe('setDefaultBackend', () => {
    it('should change the default backend', () => {
      const router = new ServiceRouter({}, 'original');

      expect(router.resolve('unknown')).toBe('original');

      router.setDefaultBackend('newDefault');

      expect(router.getDefaultBackend()).toBe('newDefault');
      expect(router.resolve('unknown')).toBe('newDefault');
    });
  });

  describe('setAvailableBackends', () => {
    it('should update available backends for validation', () => {
      const router = new ServiceRouter({}, 'default', ['core']);

      expect(router.isBackendAvailable('core')).toBe(true);
      expect(router.isBackendAvailable('new')).toBe(false);

      router.setAvailableBackends(['core', 'new', 'default']);

      expect(router.isBackendAvailable('new')).toBe(true);
    });
  });

  describe('isBackendAvailable', () => {
    it('should return true when no validation is configured', () => {
      const router = new ServiceRouter({}, 'default');

      // No available backends configured, so all backends are considered available
      expect(router.isBackendAvailable('any')).toBe(true);
      expect(router.isBackendAvailable('unknown')).toBe(true);
    });

    it('should validate against configured backends', () => {
      const router = new ServiceRouter({}, 'default', ['core', 'storage']);

      expect(router.isBackendAvailable('core')).toBe(true);
      expect(router.isBackendAvailable('storage')).toBe(true);
      expect(router.isBackendAvailable('unknown')).toBe(false);
    });
  });
});
