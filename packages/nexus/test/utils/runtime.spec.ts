/**
 * Tests for Runtime Detection Utilities
 */

import {
  Runtime,
  detectRuntime,
  getRuntimeInfo,
  isNode,
  isBun,
  isDeno,
  isBrowser,
  isServer,
  hasESMSupport,
  hasWorkerSupport,
  getGlobalObject,
  PerformanceTimer,
  getMemoryUsage
} from '../../src';

describe('Runtime Detection', () => {
  describe('detectRuntime', () => {
    it('should detect Node.js runtime', () => {
      // This test will pass when running in Node.js
      const info = detectRuntime();
      
      // Since tests are running in Node.js with Jest
      if (typeof process !== 'undefined' && process.versions?.node) {
        expect(info.runtime).toBe(Runtime.Node);
        expect(info.isServer).toBe(true);
        expect(info.isBrowser).toBe(false);
        expect(info.version).toBeDefined();
        expect(info.hasESM).toBe(true);
      }
    });

    it('should return runtime info structure', () => {
      const info = detectRuntime();
      
      expect(info).toHaveProperty('runtime');
      expect(info).toHaveProperty('isBrowser');
      expect(info).toHaveProperty('isServer');
      expect(info).toHaveProperty('hasWorkers');
      expect(info).toHaveProperty('hasESM');
    });
  });

  describe('getRuntimeInfo', () => {
    it('should cache runtime info', () => {
      const info1 = getRuntimeInfo();
      const info2 = getRuntimeInfo();
      
      expect(info1).toBe(info2);
    });

    it('should return consistent info', () => {
      const info = getRuntimeInfo();
      
      expect(info.runtime).toBeDefined();
      expect(typeof info.isBrowser).toBe('boolean');
      expect(typeof info.isServer).toBe('boolean');
      expect(typeof info.hasWorkers).toBe('boolean');
      expect(typeof info.hasESM).toBe('boolean');
    });
  });

  describe('Runtime checks', () => {
    it('should check if running in Node.js', () => {
      const result = isNode();
      
      // When running tests in Node.js
      if (typeof process !== 'undefined' && process.versions?.node) {
        expect(result).toBe(true);
      } else {
        expect(typeof result).toBe('boolean');
      }
    });

    it('should check if running in Bun', () => {
      const result = isBun();
      
      // Will be false unless running in Bun
      expect(typeof result).toBe('boolean');
      
      if ((globalThis as any).Bun) {
        expect(result).toBe(true);
      }
    });

    it('should check if running in Deno', () => {
      const result = isDeno();
      
      // Will be false unless running in Deno
      expect(typeof result).toBe('boolean');
      
      if ((globalThis as any).Deno) {
        expect(result).toBe(true);
      }
    });

    it('should check if running in browser', () => {
      const result = isBrowser();
      
      // Should be false in Node.js test environment
      expect(typeof result).toBe('boolean');
      
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        expect(result).toBe(true);
      } else {
        expect(result).toBe(false);
      }
    });

    it('should check if running on server', () => {
      const result = isServer();
      
      // Should be true in Node.js test environment
      expect(typeof result).toBe('boolean');
      
      if (typeof process !== 'undefined' && process.versions?.node) {
        expect(result).toBe(true);
      }
    });

    it('should check ESM support', () => {
      const result = hasESMSupport();
      
      expect(typeof result).toBe('boolean');
      
      // Modern Node.js has ESM support
      if (isNode()) {
        expect(result).toBe(true);
      }
    });

    it('should check Worker support', () => {
      const result = hasWorkerSupport();
      
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getGlobalObject', () => {
    it('should return global object', () => {
      const global = getGlobalObject();
      
      expect(global).toBeDefined();
      
      // In Node.js
      if (typeof globalThis !== 'undefined') {
        expect(global).toBe(globalThis);
      } else if (typeof window !== 'undefined') {
        expect(global).toBe(window);
      } else if (typeof global !== 'undefined') {
        expect(global).toBe(global);
      }
    });

    it('should have expected properties', () => {
      const global = getGlobalObject();
      
      // Common global properties
      expect(typeof global.setTimeout).toBe('function');
      expect(typeof global.clearTimeout).toBe('function');
    });
  });

  describe('PerformanceTimer', () => {
    it('should create timer and measure elapsed time', async () => {
      const timer = new PerformanceTimer();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const elapsed = timer.elapsed();
      
      expect(elapsed).toBeGreaterThan(40); // Allow some variance
      expect(elapsed).toBeLessThan(100);
    });

    it('should reset timer', async () => {
      const timer = new PerformanceTimer();
      
      await new Promise(resolve => setTimeout(resolve, 50));
      const elapsed1 = timer.elapsed();
      
      timer.reset();
      
      await new Promise(resolve => setTimeout(resolve, 20));
      const elapsed2 = timer.elapsed();
      
      expect(elapsed1).toBeGreaterThan(40);
      expect(elapsed2).toBeLessThan(30);
    });

    it('should use appropriate timing method', () => {
      const timer = new PerformanceTimer();
      
      // Should not throw
      expect(() => timer.elapsed()).not.toThrow();
      
      const elapsed = timer.elapsed();
      expect(typeof elapsed).toBe('number');
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getMemoryUsage', () => {
    it('should return memory usage or null', () => {
      const usage = getMemoryUsage();
      
      if (usage !== null) {
        expect(usage).toHaveProperty('used');
        expect(usage).toHaveProperty('total');
        expect(typeof usage.used).toBe('number');
        expect(typeof usage.total).toBe('number');
        expect(usage.used).toBeGreaterThan(0);
        expect(usage.total).toBeGreaterThan(0);
        expect(usage.total).toBeGreaterThanOrEqual(usage.used);
      } else {
        expect(usage).toBeNull();
      }
    });

    it('should work in Node.js environment', () => {
      if (isNode()) {
        const usage = getMemoryUsage();
        
        expect(usage).not.toBeNull();
        expect(usage!.used).toBeGreaterThan(0);
        expect(usage!.total).toBeGreaterThan(0);
      }
    });
  });

  describe('Runtime-specific behavior', () => {
    it('should handle different runtime environments gracefully', () => {
      const info = getRuntimeInfo();
      
      switch (info.runtime) {
        case Runtime.Node:
          expect(info.isServer).toBe(true);
          expect(info.isBrowser).toBe(false);
          break;
        case Runtime.Bun:
          expect(info.isServer).toBe(true);
          expect(info.isBrowser).toBe(false);
          expect(info.hasESM).toBe(true);
          break;
        case Runtime.Deno:
          expect(info.isServer).toBe(true);
          expect(info.isBrowser).toBe(false);
          expect(info.hasESM).toBe(true);
          break;
        case Runtime.Browser:
          expect(info.isServer).toBe(false);
          expect(info.isBrowser).toBe(true);
          break;
        case Runtime.Unknown:
          // Unknown runtime should have safe defaults
          expect(info.isServer).toBe(false);
          expect(info.isBrowser).toBe(false);
          break;
      }
    });

    it('should provide platform information when available', () => {
      const info = getRuntimeInfo();
      
      if (info.runtime === Runtime.Node || info.runtime === Runtime.Bun) {
        expect(info.platform).toBeDefined();
        expect(typeof info.platform).toBe('string');
        expect(['darwin', 'linux', 'win32', 'freebsd', 'sunos', 'aix'].some(p => 
          info.platform?.includes(p)
        )).toBe(true);
      }
    });

    it('should provide version information when available', () => {
      const info = getRuntimeInfo();
      
      if (info.runtime !== Runtime.Unknown) {
        // Most runtimes provide version info
        if (info.version) {
          expect(typeof info.version).toBe('string');
          expect(info.version.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Cross-platform compatibility', () => {
    it('should not throw errors in any environment', () => {
      expect(() => detectRuntime()).not.toThrow();
      expect(() => getRuntimeInfo()).not.toThrow();
      expect(() => isNode()).not.toThrow();
      expect(() => isBun()).not.toThrow();
      expect(() => isDeno()).not.toThrow();
      expect(() => isBrowser()).not.toThrow();
      expect(() => isServer()).not.toThrow();
      expect(() => hasESMSupport()).not.toThrow();
      expect(() => hasWorkerSupport()).not.toThrow();
      expect(() => getGlobalObject()).not.toThrow();
      expect(() => new PerformanceTimer()).not.toThrow();
      expect(() => getMemoryUsage()).not.toThrow();
    });

    it('should provide consistent API across platforms', () => {
      const info = getRuntimeInfo();
      
      // All required properties should exist
      expect(info).toHaveProperty('runtime');
      expect(info).toHaveProperty('isBrowser');
      expect(info).toHaveProperty('isServer');
      expect(info).toHaveProperty('hasWorkers');
      expect(info).toHaveProperty('hasESM');
      
      // Runtime should be one of the defined values
      expect(Object.values(Runtime)).toContain(info.runtime);
    });
  });
});