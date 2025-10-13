/**
 * @fileoverview Comprehensive tests for Hydration System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hydrate,
  hydrateRoot,
  preserveServerState,
  getHydrationMismatches,
  clearHydrationState,
  registerComponent,
} from '../../src/server/hydration.js';

// Mock DOM environment
const createMockElement = (tagName: string, attributes: Record<string, string> = {}, children: any[] = []): any => ({
  tagName: tagName.toUpperCase(),
  nodeName: tagName.toUpperCase(),
  textContent: '',
  innerHTML: '',
  childNodes: children,
  children,
  attributes,
  getAttribute: (name: string) => attributes[name] || null,
  setAttribute: vi.fn(),
  removeAttribute: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  replaceWith: vi.fn(),
  appendChild: vi.fn(),
  parentElement: null,
});

describe('Hydration System', () => {
  let mockContainer: any;

  beforeEach(() => {
    clearHydrationState();
    mockContainer = createMockElement('div', { id: 'root' });
    mockContainer.textContent = '<div>Server Content</div>';
  });

  afterEach(() => {
    clearHydrationState();
  });

  describe('hydrate', () => {
    it('should hydrate basic component', () => {
      const Component = () => 'Hydrated Content';

      expect(() => {
        hydrate(Component, mockContainer);
      }).not.toThrow();
    });

    it('should throw error if container is null', () => {
      const Component = () => 'Content';

      expect(() => {
        hydrate(Component, null);
      }).toThrow('Hydration container not found');
    });

    it('should load server state', () => {
      const Component = () => 'Content';
      const serverState = {
        user: { id: 1, name: 'Alice' },
        posts: [{ id: 1, title: 'Post 1' }],
      };

      hydrate(Component, mockContainer, { serverState });

      expect(preserveServerState('user')).toEqual({ id: 1, name: 'Alice' });
      expect(preserveServerState('posts')).toEqual([{ id: 1, title: 'Post 1' }]);
    });

    it('should use eager strategy by default', () => {
      const Component = vi.fn(() => 'Content');

      hydrate(Component, mockContainer);

      expect(Component).toHaveBeenCalled();
    });

    it('should support progressive hydration with idle strategy', () => {
      const Component = () => 'Content';

      // Mock requestIdleCallback
      const mockRequestIdleCallback = vi.fn((callback) => {
        callback();
      });
      (global as any).requestIdleCallback = mockRequestIdleCallback;

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'idle',
      });

      expect(mockRequestIdleCallback).toHaveBeenCalled();

      delete (global as any).requestIdleCallback;
    });

    it('should fallback to setTimeout if requestIdleCallback unavailable', () => {
      const Component = () => 'Content';

      const mockSetTimeout = vi.spyOn(global, 'setTimeout');

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'idle',
      });

      expect(mockSetTimeout).toHaveBeenCalled();

      mockSetTimeout.mockRestore();
    });

    it('should hydrate on interaction with lazy strategy', () => {
      const Component = () => 'Content';

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'lazy',
      });

      expect(mockContainer.addEventListener).toHaveBeenCalled();
      const eventTypes = ['mousedown', 'touchstart', 'keydown', 'scroll'];
      eventTypes.forEach((eventType) => {
        expect(mockContainer.addEventListener).toHaveBeenCalledWith(
          eventType,
          expect.any(Function),
          expect.objectContaining({ once: true, passive: true })
        );
      });
    });

    it('should hydrate when visible with visible strategy', () => {
      const Component = () => 'Content';

      // Mock IntersectionObserver
      const mockObserve = vi.fn();
      const mockDisconnect = vi.fn();
      (global as any).IntersectionObserver = vi.fn((callback) => ({
        observe: mockObserve,
        disconnect: mockDisconnect,
        root: null,
        rootMargin: '50px',
        thresholds: [],
      }));

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'visible',
      });

      expect(mockObserve).toHaveBeenCalledWith(mockContainer);

      delete (global as any).IntersectionObserver;
    });

    it('should handle islands architecture', () => {
      const islandElement = createMockElement('div', {
        'data-island': 'island-1',
        'data-component': 'Counter',
      });
      mockContainer.children = [islandElement];

      registerComponent('Counter', () => 'Counter Component');

      const islands = [
        {
          id: 'island-1',
          component: 'Counter',
          props: {},
          strategy: 'idle' as const,
        },
      ];

      hydrate(() => 'App', mockContainer, { islands: true });

      // Islands should be loaded
      const mismatches = getHydrationMismatches();
      expect(mismatches).toEqual([]);
    });

    it('should call onMismatch handler for hydration errors', () => {
      const onMismatch = vi.fn();
      const Component = () => 'Client Content';

      // Server content differs from client
      mockContainer.textContent = 'Server Content';

      hydrate(Component, mockContainer, { onMismatch });

      // Expect mismatch to be reported
      expect(onMismatch).toHaveBeenCalled();
    });
  });

  describe('hydrateRoot', () => {
    it('should hydrate root element', () => {
      const childElement = createMockElement('div', {}, []);
      mockContainer.firstElementChild = childElement;

      expect(() => {
        hydrateRoot(mockContainer);
      }).not.toThrow();
    });

    it('should throw if no component found in container', () => {
      mockContainer.firstElementChild = null;

      expect(() => {
        hydrateRoot(mockContainer);
      }).toThrow('No component found in container');
    });
  });

  describe('Server State Preservation', () => {
    it('should preserve server state for client access', () => {
      const serverState = {
        user: { id: 1, name: 'Alice' },
        settings: { theme: 'dark' },
      };

      hydrate(() => 'App', mockContainer, { serverState });

      expect(preserveServerState('user')).toEqual({ id: 1, name: 'Alice' });
      expect(preserveServerState('settings')).toEqual({ theme: 'dark' });
    });

    it('should return undefined for non-existent keys', () => {
      hydrate(() => 'App', mockContainer);

      expect(preserveServerState('nonexistent')).toBeUndefined();
    });

    it('should handle complex nested data', () => {
      const complexData = {
        deeply: {
          nested: {
            data: {
              value: 42,
              array: [1, 2, 3],
            },
          },
        },
      };

      hydrate(() => 'App', mockContainer, {
        serverState: { complex: complexData },
      });

      expect(preserveServerState('complex')).toEqual(complexData);
    });
  });

  describe('Hydration Mismatches', () => {
    it('should detect text content mismatches', () => {
      const Component = () => 'Client Text';
      mockContainer.textContent = 'Server Text';

      hydrate(Component, mockContainer);

      const mismatches = getHydrationMismatches();
      expect(mismatches.length).toBeGreaterThan(0);
      expect(mismatches[0].type).toBe('mismatch');
    });

    it('should track mismatch paths', () => {
      const Component = () => 'Different';
      mockContainer.textContent = 'Original';

      hydrate(Component, mockContainer);

      const mismatches = getHydrationMismatches();
      expect(mismatches[0]).toHaveProperty('path');
      expect(mismatches[0]).toHaveProperty('server');
      expect(mismatches[0]).toHaveProperty('client');
    });

    it('should clear mismatches on clearHydrationState', () => {
      const Component = () => 'Client';
      mockContainer.textContent = 'Server';

      hydrate(Component, mockContainer);

      expect(getHydrationMismatches().length).toBeGreaterThan(0);

      clearHydrationState();

      expect(getHydrationMismatches()).toEqual([]);
    });

    it('should handle missing content gracefully', () => {
      const Component = () => null;
      mockContainer.textContent = 'Exists';

      hydrate(Component, mockContainer);

      const mismatches = getHydrationMismatches();
      expect(mismatches.some((m) => m.type === 'missing')).toBe(true);
    });
  });

  describe('Island Hydration', () => {
    it('should hydrate islands independently', () => {
      const island1 = createMockElement('div', {
        'data-island': 'island-1',
        'data-component': 'Counter',
      });
      const island2 = createMockElement('div', {
        'data-island': 'island-2',
        'data-component': 'Timer',
      });

      mockContainer.children = [island1, island2];

      registerComponent('Counter', () => 'Counter');
      registerComponent('Timer', () => 'Timer');

      hydrate(() => 'App', mockContainer, { islands: true });

      // Both islands should be processed
      expect(getHydrationMismatches()).toEqual([]);
    });

    it('should handle island with props', () => {
      const island = createMockElement('div', {
        'data-island': 'island-1',
        'data-component': 'Counter',
        'data-props': JSON.stringify({ initialCount: 10 }),
      });

      mockContainer.children = [island];

      const CounterComponent = vi.fn(() => 'Counter');
      registerComponent('Counter', CounterComponent);

      hydrate(() => 'App', mockContainer, { islands: true });

      // Component should be registered for hydration
      expect(getHydrationMismatches()).toEqual([]);
    });

    it('should warn if island component not registered', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation();

      const island = createMockElement('div', {
        'data-island': 'island-1',
        'data-component': 'UnknownComponent',
      });

      mockContainer.children = [island];

      hydrate(() => 'App', mockContainer, { islands: true });

      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('Island component not registered'));

      consoleWarn.mockRestore();
    });
  });

  describe('Progressive Hydration Strategies', () => {
    it('should execute eager strategy immediately', () => {
      const Component = vi.fn(() => 'Content');

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'eager',
      });

      expect(Component).toHaveBeenCalled();
    });

    it('should defer idle strategy until browser idle', () => {
      const Component = vi.fn(() => 'Content');

      const callbacks: Function[] = [];
      (global as any).requestIdleCallback = (cb: Function) => {
        callbacks.push(cb);
      };

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'idle',
      });

      expect(Component).not.toHaveBeenCalled();

      // Execute callbacks
      callbacks.forEach((cb) => cb());

      expect(Component).toHaveBeenCalled();

      delete (global as any).requestIdleCallback;
    });

    it('should hydrate on first interaction for lazy strategy', () => {
      const Component = vi.fn(() => 'Content');

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'lazy',
      });

      expect(Component).not.toHaveBeenCalled();

      // Simulate interaction
      const mousedownHandler = mockContainer.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'mousedown'
      )?.[1];

      if (mousedownHandler) {
        mousedownHandler();
      }

      expect(Component).toHaveBeenCalled();
    });

    it('should hydrate when element becomes visible', () => {
      const Component = vi.fn(() => 'Content');

      let observerCallback: Function | null = null;
      (global as any).IntersectionObserver = vi.fn((callback) => {
        observerCallback = callback;
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
      });

      hydrate(Component, mockContainer, {
        progressive: true,
        strategy: 'visible',
      });

      expect(Component).not.toHaveBeenCalled();

      // Simulate visibility
      if (observerCallback) {
        observerCallback([{ isIntersecting: true }]);
      }

      expect(Component).toHaveBeenCalled();

      delete (global as any).IntersectionObserver;
    });
  });

  describe('Error Handling', () => {
    it('should handle hydration errors gracefully', () => {
      const ErrorComponent = () => {
        throw new Error('Hydration error');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      expect(() => {
        hydrate(ErrorComponent, mockContainer);
      }).not.toThrow();

      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('should fallback to client render on hydration failure', () => {
      const Component = () => {
        throw new Error('Failed');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      hydrate(Component, mockContainer);

      // Should clear container and re-render
      expect(consoleError).toHaveBeenCalledWith('Hydration failed:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('Component Registration', () => {
    it('should register component for island hydration', () => {
      const Counter = () => 'Counter';

      expect(() => {
        registerComponent('Counter', Counter);
      }).not.toThrow();
    });

    it('should retrieve registered components', () => {
      const Counter = () => 'Counter';
      registerComponent('Counter', Counter);

      const island = createMockElement('div', {
        'data-island': 'island-1',
        'data-component': 'Counter',
      });

      mockContainer.children = [island];

      // Should not warn about missing component
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation();

      hydrate(() => 'App', mockContainer, { islands: true });

      expect(consoleWarn).not.toHaveBeenCalledWith(expect.stringContaining('not registered'));

      consoleWarn.mockRestore();
    });
  });

  describe('State Management', () => {
    it('should clear all hydration state', () => {
      const serverState = {
        user: { id: 1, name: 'Alice' },
      };

      hydrate(() => 'App', mockContainer, { serverState });

      expect(preserveServerState('user')).toBeDefined();

      clearHydrationState();

      expect(preserveServerState('user')).toBeUndefined();
      expect(getHydrationMismatches()).toEqual([]);
    });

    it('should maintain separate state per hydration', () => {
      const container1 = createMockElement('div', { id: 'app1' });
      const container2 = createMockElement('div', { id: 'app2' });

      hydrate(() => 'App1', container1, {
        serverState: { app: 'app1' },
      });

      clearHydrationState();

      hydrate(() => 'App2', container2, {
        serverState: { app: 'app2' },
      });

      expect(preserveServerState('app')).toBe('app2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty components', () => {
      const EmptyComponent = () => null;

      expect(() => {
        hydrate(EmptyComponent, mockContainer);
      }).not.toThrow();
    });

    it('should handle components returning arrays', () => {
      const ArrayComponent = () => ['Item 1', 'Item 2', 'Item 3'];

      expect(() => {
        hydrate(ArrayComponent, mockContainer);
      }).not.toThrow();
    });

    it('should handle deeply nested components', () => {
      const DeepComponent = () => ({
        children: [{ children: [{ children: ['Deep'] }] }],
      });

      expect(() => {
        hydrate(DeepComponent, mockContainer);
      }).not.toThrow();
    });

    it('should handle missing IntersectionObserver gracefully', () => {
      const Component = () => 'Content';
      const originalIO = (global as any).IntersectionObserver;

      delete (global as any).IntersectionObserver;

      // Should fallback to eager hydration
      expect(() => {
        hydrate(Component, mockContainer, {
          progressive: true,
          strategy: 'visible',
        });
      }).not.toThrow();

      (global as any).IntersectionObserver = originalIO;
    });
  });
});
