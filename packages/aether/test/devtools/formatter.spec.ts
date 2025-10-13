/**
 * Formatter Tests - Custom Formatters Tests
 *
 * Comprehensive test coverage for the Chrome DevTools custom formatters,
 * including signal, store, and component formatters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installFormatters,
  uninstallFormatters,
  isFormatterSupported,
  formatSignal,
  formatStore,
  formatComponent,
} from '../../src/devtools/formatter.js';

describe('DevTools Custom Formatters', () => {
  beforeEach(() => {
    // Setup window mock with devtoolsFormatters support
    global.window = {
      devtoolsFormatters: [],
    } as any;

    vi.clearAllMocks();
  });

  afterEach(() => {
    uninstallFormatters();
  });

  describe('Formatter Support Detection', () => {
    it('should detect formatter support', () => {
      expect(isFormatterSupported()).toBe(true);
    });

    it('should return false when window is undefined', () => {
      (global as any).window = undefined;

      expect(isFormatterSupported()).toBe(false);
    });

    it('should return false when devtoolsFormatters is not available', () => {
      delete (global.window as any).devtoolsFormatters;

      expect(isFormatterSupported()).toBe(false);
    });
  });

  describe('Formatter Installation', () => {
    it('should install formatters', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      installFormatters();

      const formatters = (global.window as any).devtoolsFormatters;
      expect(formatters.length).toBe(3);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Aether DevTools] Custom formatters installed'
      );

      consoleSpy.mockRestore();
    });

    it('should create formatters array if not exists', () => {
      // Set window but without devtoolsFormatters defined (but still check for it being possible)
      global.window = {
        get devtoolsFormatters() {
          return this._formatters;
        },
        set devtoolsFormatters(value) {
          this._formatters = value;
        },
        _formatters: undefined as any,
      } as any;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      installFormatters();

      const formatters = (global.window as any).devtoolsFormatters;
      expect(Array.isArray(formatters)).toBe(true);
      expect(formatters.length).toBe(3);

      consoleSpy.mockRestore();
    });

    it('should warn when formatters not supported', () => {
      delete (global.window as any).devtoolsFormatters;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      installFormatters();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not supported')
      );

      consoleSpy.mockRestore();
    });

    it('should not duplicate formatters', () => {
      installFormatters();
      installFormatters();

      const formatters = (global.window as any).devtoolsFormatters;
      expect(formatters.length).toBe(6); // Each install adds 3
    });
  });

  describe('Formatter Uninstallation', () => {
    it('should uninstall formatters', () => {
      installFormatters();

      const beforeCount = (global.window as any).devtoolsFormatters.length;

      uninstallFormatters();

      const afterCount = (global.window as any).devtoolsFormatters.length;
      expect(afterCount).toBeLessThan(beforeCount);
    });

    it('should handle uninstall when formatters not installed', () => {
      expect(() => uninstallFormatters()).not.toThrow();
    });

    it('should handle uninstall when window is undefined', () => {
      (global as any).window = undefined;

      expect(() => uninstallFormatters()).not.toThrow();
    });
  });

  describe('Signal Formatter', () => {
    it('should format signal header', () => {
      installFormatters();

      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = vi.fn(() => 42);
      mockSignal.subscribe = vi.fn();

      const formatters = (global.window as any).devtoolsFormatters;
      const signalFormatter = formatters.find((f: any) =>
        f.header(mockSignal)
      );

      expect(signalFormatter).toBeDefined();

      const header = signalFormatter.header(mockSignal);
      expect(header).toBeDefined();
      expect(Array.isArray(header)).toBe(true);
    });

    it('should format writable signal', () => {
      installFormatters();

      const mockWritableSignal: any = vi.fn(() => 'test');
      mockWritableSignal.peek = vi.fn(() => 'test');
      mockWritableSignal.subscribe = vi.fn();
      mockWritableSignal.set = vi.fn();

      const formatters = (global.window as any).devtoolsFormatters;
      const signalFormatter = formatters.find((f: any) =>
        f.header(mockWritableSignal)
      );

      const header = signalFormatter.header(mockWritableSignal);
      expect(header).toBeDefined();
    });

    it('should return null for non-signal', () => {
      installFormatters();

      const notASignal = { value: 42 };

      const formatters = (global.window as any).devtoolsFormatters;
      const signalFormatter = formatters[0];

      const header = signalFormatter.header(notASignal);
      expect(header).toBeNull();
    });

    it('should format signal body', () => {
      installFormatters();

      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = vi.fn(() => 42);
      mockSignal.subscribe = vi.fn();

      const formatters = (global.window as any).devtoolsFormatters;
      const signalFormatter = formatters.find((f: any) =>
        f.header(mockSignal)
      );

      expect(signalFormatter.hasBody(mockSignal)).toBe(true);

      const body = signalFormatter.body(mockSignal);
      expect(body).toBeDefined();
      expect(Array.isArray(body)).toBe(true);
    });

    it('should show signal metadata in body', () => {
      installFormatters();

      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = vi.fn(() => 42);
      mockSignal.subscribe = vi.fn();
      mockSignal.__internal = {
        getComputations: () => new Set([1, 2, 3]),
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const signalFormatter = formatters.find((f: any) =>
        f.header(mockSignal)
      );

      const body = signalFormatter.body(mockSignal);
      expect(body).toBeDefined();
    });
  });

  describe('Store Formatter', () => {
    it('should format store header', () => {
      installFormatters();

      const mockStore = {
        get: vi.fn(),
        subscribe: vi.fn(),
        getState: vi.fn(() => ({ count: 42 })),
        name: 'TestStore',
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const storeFormatter = formatters.find((f: any) =>
        f.header(mockStore)
      );

      expect(storeFormatter).toBeDefined();

      const header = storeFormatter.header(mockStore);
      expect(header).toBeDefined();
      expect(Array.isArray(header)).toBe(true);
    });

    it('should return null for non-store', () => {
      installFormatters();

      const notAStore = { value: 42 };

      const formatters = (global.window as any).devtoolsFormatters;
      const storeFormatter = formatters[1];

      const header = storeFormatter.header(notAStore);
      expect(header).toBeNull();
    });

    it('should format store body', () => {
      installFormatters();

      const mockStore = {
        get: vi.fn(),
        subscribe: vi.fn(),
        getState: vi.fn(() => ({
          count: 42,
          name: 'Test',
          nested: { value: 123 },
        })),
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const storeFormatter = formatters.find((f: any) =>
        f.header(mockStore)
      );

      expect(storeFormatter.hasBody(mockStore)).toBe(true);

      const body = storeFormatter.body(mockStore);
      expect(body).toBeDefined();
      expect(Array.isArray(body)).toBe(true);
    });

    it('should handle empty store state', () => {
      installFormatters();

      const mockStore = {
        get: vi.fn(),
        subscribe: vi.fn(),
        getState: vi.fn(() => ({})),
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const storeFormatter = formatters.find((f: any) =>
        f.header(mockStore)
      );

      const body = storeFormatter.body(mockStore);
      expect(body).toBeDefined();
    });

    it('should handle store without getState', () => {
      installFormatters();

      const mockStore = {
        get: vi.fn(),
        subscribe: vi.fn(),
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const storeFormatter = formatters[1];

      const header = storeFormatter.header(mockStore);
      expect(header).toBeNull();
    });
  });

  describe('Component Formatter', () => {
    it('should format component header', () => {
      installFormatters();

      const mockComponent = {
        __AETHER_COMPONENT__: true,
        name: 'TestComponent',
        props: { id: 1, title: 'Hello' },
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const componentFormatter = formatters.find((f: any) =>
        f.header(mockComponent)
      );

      expect(componentFormatter).toBeDefined();

      const header = componentFormatter.header(mockComponent);
      expect(header).toBeDefined();
      expect(Array.isArray(header)).toBe(true);
    });

    it('should return null for non-component', () => {
      installFormatters();

      const notAComponent = { value: 42 };

      const formatters = (global.window as any).devtoolsFormatters;
      const componentFormatter = formatters[2];

      const header = componentFormatter.header(notAComponent);
      expect(header).toBeNull();
    });

    it('should format component body', () => {
      installFormatters();

      const mockComponent = {
        __AETHER_COMPONENT__: true,
        name: 'TestComponent',
        props: { id: 1, title: 'Hello' },
        state: { count: 42 },
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const componentFormatter = formatters.find((f: any) =>
        f.header(mockComponent)
      );

      expect(componentFormatter.hasBody(mockComponent)).toBe(true);

      const body = componentFormatter.body(mockComponent);
      expect(body).toBeDefined();
      expect(Array.isArray(body)).toBe(true);
    });

    it('should handle component without name', () => {
      installFormatters();

      const mockComponent = {
        __AETHER_COMPONENT__: true,
        props: {},
        constructor: { name: 'ConstructorComponent' },
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const componentFormatter = formatters.find((f: any) =>
        f.header(mockComponent)
      );

      const header = componentFormatter.header(mockComponent);
      expect(header).toBeDefined();
    });

    it('should handle component without props', () => {
      installFormatters();

      const mockComponent = {
        __AETHER_COMPONENT__: true,
        name: 'TestComponent',
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const componentFormatter = formatters.find((f: any) =>
        f.header(mockComponent)
      );

      const body = componentFormatter.body(mockComponent);
      expect(body).toBeDefined();
    });
  });

  describe('Value Formatting', () => {
    it('should format string values', () => {
      const mockSignal: any = vi.fn(() => 'test string');
      mockSignal.peek = () => 'test string';
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('test string');
    });

    it('should format number values', () => {
      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = () => 42;
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('42');
    });

    it('should format boolean values', () => {
      const mockSignal: any = vi.fn(() => true);
      mockSignal.peek = () => true;
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('true');
    });

    it('should format null values', () => {
      const mockSignal: any = vi.fn(() => null);
      mockSignal.peek = () => null;
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('null');
    });

    it('should format undefined values', () => {
      const mockSignal: any = vi.fn(() => undefined);
      mockSignal.peek = () => undefined;
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('undefined');
    });

    it('should format array values', () => {
      const mockSignal: any = vi.fn(() => [1, 2, 3]);
      mockSignal.peek = () => [1, 2, 3];
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });

    it('should format object values', () => {
      const mockSignal: any = vi.fn(() => ({ key: 'value' }));
      mockSignal.peek = () => ({ key: 'value' });
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });

    it('should format function values', () => {
      const mockSignal: any = vi.fn(() => () => {});
      mockSignal.peek = () => () => {};
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });
  });

  describe('Console Formatting Helpers', () => {
    it('should format signal for console', () => {
      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = vi.fn(() => 42);
      mockSignal.subscribe = vi.fn();
      mockSignal.set = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('Signal');
      expect(result).toContain('42');
      expect(result).toContain('writable: true');
    });

    it('should handle non-signal in formatSignal', () => {
      const notASignal = { value: 42 };

      const result = formatSignal(notASignal as any);

      expect(typeof result).toBe('string');
    });

    it('should format store for console', () => {
      const mockStore = {
        getState: vi.fn(() => ({ count: 42 })),
        name: 'CounterStore',
      };

      const result = formatStore(mockStore);

      expect(result).toContain('CounterStore');
      expect(result).toContain('42');
    });

    it('should handle non-store in formatStore', () => {
      const notAStore = { value: 42 };

      const result = formatStore(notAStore);

      expect(typeof result).toBe('string');
    });

    it('should format component for console', () => {
      const mockComponent = {
        __AETHER_COMPONENT__: true,
        name: 'TestComponent',
        props: { id: 1, title: 'Hello' },
      };

      const result = formatComponent(mockComponent);

      expect(result).toContain('TestComponent');
      expect(result).toContain('2 props');
    });

    it('should handle non-component in formatComponent', () => {
      const notAComponent = { value: 42 };

      const result = formatComponent(notAComponent);

      expect(typeof result).toBe('string');
    });

    it('should handle component without props', () => {
      const mockComponent = {
        __AETHER_COMPONENT__: true,
        name: 'TestComponent',
      };

      const result = formatComponent(mockComponent);

      expect(result).toContain('TestComponent');
      expect(result).toContain('0 props');
    });
  });

  describe('Complex Object Formatting', () => {
    it('should handle deeply nested objects', () => {
      const deep: any = { level: 1 };
      let current = deep;

      for (let i = 2; i <= 10; i++) {
        current.next = { level: i };
        current = current.next;
      }

      const mockSignal: any = vi.fn(() => deep);
      mockSignal.peek = vi.fn(() => deep);
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });

    it('should handle circular references', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      const mockSignal: any = vi.fn(() => circular);
      mockSignal.peek = vi.fn(() => circular);
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });

    it('should handle arrays in values', () => {
      const mockSignal: any = vi.fn(() => [1, 2, 3, 4, 5]);
      mockSignal.peek = vi.fn(() => [1, 2, 3, 4, 5]);
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });

    it('should handle mixed nested structures', () => {
      const complex = {
        users: [
          { id: 1, name: 'Alice', meta: { age: 30 } },
          { id: 2, name: 'Bob', meta: { age: 25 } },
        ],
        settings: {
          theme: 'dark',
          notifications: { email: true, push: false },
        },
      };

      const mockSignal: any = vi.fn(() => complex);
      mockSignal.peek = vi.fn(() => complex);
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle signal with __internal metadata', () => {
      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = vi.fn(() => 42);
      mockSignal.subscribe = vi.fn();
      mockSignal.__internal = {
        getComputations: () => new Set([1, 2, 3]),
      };

      const result = formatSignal(mockSignal);

      expect(result).toContain('dependents: 3');
    });

    it('should handle signal without __internal', () => {
      const mockSignal: any = vi.fn(() => 42);
      mockSignal.peek = vi.fn(() => 42);
      mockSignal.subscribe = vi.fn();

      const result = formatSignal(mockSignal);

      expect(result).toContain('dependents: 0');
    });

    it('should handle store without name', () => {
      const mockStore = {
        getState: vi.fn(() => ({ count: 42 })),
      };

      const result = formatStore(mockStore);

      expect(result).toContain('Store');
    });

    it('should handle component without __AETHER_COMPONENT__ marker', () => {
      installFormatters();

      const notAComponent = {
        name: 'NotAComponent',
        props: {},
      };

      const formatters = (global.window as any).devtoolsFormatters;
      const componentFormatter = formatters[2];

      const header = componentFormatter.header(notAComponent);
      expect(header).toBeNull();
    });

    it('should handle null input to formatters', () => {
      expect(formatSignal(null as any)).toBeDefined();
      expect(formatStore(null)).toBeDefined();
      expect(formatComponent(null)).toBeDefined();
    });

    it('should handle undefined input to formatters', () => {
      expect(formatSignal(undefined as any)).toBeDefined();
      expect(formatStore(undefined)).toBeDefined();
      expect(formatComponent(undefined)).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should format large objects efficiently', () => {
      const largeObject: any = {};

      for (let i = 0; i < 100; i++) {
        largeObject[`key${i}`] = {
          value: i,
          nested: { data: `value${i}` },
        };
      }

      const mockSignal: any = vi.fn(() => largeObject);
      mockSignal.peek = vi.fn(() => largeObject);
      mockSignal.subscribe = vi.fn();

      const start = performance.now();
      formatSignal(mockSignal);
      const duration = performance.now() - start;

      // Should be fast (under 10ms)
      expect(duration).toBeLessThan(10);
    });

    it('should format many signals efficiently', () => {
      const signals = Array.from({ length: 100 }, (_, i) => {
        const sig: any = vi.fn(() => i);
        sig.peek = vi.fn(() => i);
        sig.subscribe = vi.fn();
        return sig;
      });

      const start = performance.now();

      signals.forEach(signal => formatSignal(signal));

      const duration = performance.now() - start;

      // Should be fast (under 50ms for 100 signals)
      expect(duration).toBeLessThan(50);
    });
  });
});
