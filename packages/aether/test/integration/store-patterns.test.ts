/**
 * Integration tests for store patterns with computed and effects
 */

import { it, vi, expect, describe, afterEach } from 'vitest';
import { signal, computed, effect, createRoot } from '../../src/core/reactivity/index.js';
import {
  createMethodBasedStore,
  createSignalBasedStore,
  createComputedBasedStore,
  createComplexStore,
} from '../fixtures/sample-store-patterns.js';

describe('Store Patterns Integration Tests', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  describe('Method-based store pattern', () => {
    it('computed tracks changes when store methods call signals', () => {
      createRoot((d) => {
        dispose = d;

        const appStore = createMethodBasedStore();

        // Create computed that depends on store
        const theme = computed(() => (appStore.sidebarComponent()?.focused ? 'accent' : 'muted'));

        // Verify initial state
        expect(theme()).toBe('muted');

        // Update store
        appStore.setSidebarFocused(true);

        // Computed should reflect the change
        expect(theme()).toBe('accent');

        // Update again
        appStore.setSidebarFocused(false);
        expect(theme()).toBe('muted');
      });
    });

    it('effect tracks changes with method-based store', async () => {
      await new Promise<void>((resolve) => {
        createRoot((d) => {
          dispose = d;

          const appStore = createMethodBasedStore();
          const results: string[] = [];

          effect(() => {
            const theme = appStore.sidebarComponent()?.focused ? 'accent' : 'muted';
            results.push(theme);
          });

          // Initial value
          expect(results).toEqual(['muted']);

          // Update and wait for effect
          appStore.setSidebarFocused(true);

          setTimeout(() => {
            expect(results).toEqual(['muted', 'accent']);

            appStore.setSidebarFocused(false);

            setTimeout(() => {
              expect(results).toEqual(['muted', 'accent', 'muted']);
              resolve();
            }, 20);
          }, 20);
        });
      });
    });

    it('handles complex nested structures', () => {
      createRoot((d) => {
        dispose = d;

        const appStore = createMethodBasedStore();

        const displayText = computed(() => {
          const sidebar = appStore.sidebarComponent();
          const user = appStore.user();

          if (!sidebar && !user.preferences) return 'empty';
          if (sidebar?.focused && user.preferences?.darkMode) return 'focused-dark';
          if (sidebar?.focused) return 'focused-light';
          if (user.preferences?.darkMode) return 'unfocused-dark';
          return 'unfocused-light';
        });

        expect(displayText()).toBe('empty');

        appStore.setSidebarFocused(true);
        expect(displayText()).toBe('focused-light');

        appStore.setUserPreferences({ darkMode: true });
        expect(displayText()).toBe('focused-dark');

        appStore.setSidebarFocused(false);
        expect(displayText()).toBe('unfocused-dark');
      });
    });
  });

  describe('Signal-based store pattern', () => {
    it('computed tracks direct signal properties', () => {
      createRoot((d) => {
        dispose = d;

        const appStore = createSignalBasedStore();

        const theme = computed(() => (appStore.sidebarComponent()?.focused ? 'accent' : 'muted'));

        expect(theme()).toBe('muted');

        appStore.sidebarComponent.set({ focused: true });
        expect(theme()).toBe('accent');

        appStore.sidebarComponent.set({ focused: false, visible: true });
        expect(theme()).toBe('muted');
      });
    });

    it('multiple computeds can depend on same store signal', () => {
      createRoot((d) => {
        dispose = d;

        const appStore = createSignalBasedStore();

        const theme = computed(() => (appStore.sidebarComponent()?.focused ? 'accent' : 'muted'));

        const visibility = computed(() => (appStore.sidebarComponent()?.visible ? 'shown' : 'hidden'));

        const width = computed(() => appStore.sidebarComponent()?.width ?? 300);

        expect(theme()).toBe('muted');
        expect(visibility()).toBe('hidden');
        expect(width()).toBe(300);

        appStore.sidebarComponent.set({
          focused: true,
          visible: true,
          width: 250,
        });

        expect(theme()).toBe('accent');
        expect(visibility()).toBe('shown');
        expect(width()).toBe(250);
      });
    });
  });

  describe('Computed-based store pattern', () => {
    it('nested computeds track correctly', () => {
      createRoot((d) => {
        dispose = d;

        const appStore = createComputedBasedStore();

        // Computed depending on store's computed
        const theme = computed(() => (appStore.sidebarComponent()?.focused ? 'accent' : 'muted'));

        expect(theme()).toBe('muted');

        appStore.setSidebarFocused(true);
        expect(theme()).toBe('accent');
      });
    });
  });

  describe('Complex store with multiple computeds', () => {
    it('tracks all dependencies correctly', () => {
      createRoot((d) => {
        dispose = d;

        const store = createComplexStore();

        // Get initial values
        expect(store.theme()).toBe('light-muted');
        expect(store.isDarkMode()).toBe(false);
        expect(store.isFocused()).toBe(false);

        // Toggle focus
        store.toggleFocus();
        expect(store.theme()).toBe('light-accent');
        expect(store.isFocused()).toBe(true);

        // Toggle dark mode
        store.toggleDarkMode();
        expect(store.theme()).toBe('dark-accent');
        expect(store.isDarkMode()).toBe(true);

        // Toggle focus off
        store.toggleFocus();
        expect(store.theme()).toBe('dark-muted');
        expect(store.isFocused()).toBe(false);
      });
    });

    it('computed chains update efficiently', () => {
      createRoot((d) => {
        dispose = d;

        const store = createComplexStore();
        const computeFn = vi.fn(
          () => `Theme: ${store.theme()}, Dark: ${store.isDarkMode()}, Focused: ${store.isFocused()}`
        );

        const summary = computed(computeFn);

        // Initial computation
        expect(summary()).toBe('Theme: light-muted, Dark: false, Focused: false');
        expect(computeFn).toHaveBeenCalledTimes(1);

        // Access again - should use cache
        expect(summary()).toBe('Theme: light-muted, Dark: false, Focused: false');
        expect(computeFn).toHaveBeenCalledTimes(1);

        // Change state
        store.toggleFocus();
        expect(summary()).toBe('Theme: light-accent, Dark: false, Focused: true');
        expect(computeFn).toHaveBeenCalledTimes(2);

        // Another change
        store.toggleDarkMode();
        expect(summary()).toBe('Theme: dark-accent, Dark: true, Focused: true');
        expect(computeFn).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('Performance characteristics', () => {
    it('only recomputes when tracked dependencies change', () => {
      createRoot((d) => {
        dispose = d;

        const sidebarSignal = signal({ focused: false, width: 300 });
        const otherSignal = signal({ value: 'unrelated' });

        const store = {
          sidebar: () => sidebarSignal(),
          other: () => otherSignal(),
        };

        const computeFn = vi.fn(() => (store.sidebar().focused ? 'accent' : 'muted'));

        const theme = computed(computeFn);

        // Initial computation
        expect(theme()).toBe('muted');
        expect(computeFn).toHaveBeenCalledTimes(1);

        // Change untracked value
        otherSignal.set({ value: 'changed' });
        expect(theme()).toBe('muted');
        expect(computeFn).toHaveBeenCalledTimes(1); // Not recomputed

        // Change tracked value
        sidebarSignal.set({ focused: true, width: 300 });
        expect(theme()).toBe('accent');
        expect(computeFn).toHaveBeenCalledTimes(2); // Recomputed
      });
    });

    it('handles rapid updates efficiently', () => {
      createRoot((d) => {
        dispose = d;

        const store = createSignalBasedStore();
        const computeFn = vi.fn(() => {
          const sidebar = store.sidebarComponent();
          return sidebar?.focused ? (sidebar.width ?? 300) : 0;
        });

        const width = computed(computeFn);

        // Initial
        expect(width()).toBe(0);
        expect(computeFn).toHaveBeenCalledTimes(1);

        // Rapid updates
        for (let i = 1; i <= 10; i++) {
          store.sidebarComponent.set({ focused: true, width: i * 10 });
          expect(width()).toBe(i * 10);
        }

        // Should have computed once per update
        expect(computeFn).toHaveBeenCalledTimes(11); // 1 initial + 10 updates
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('handles undefined and null values gracefully', () => {
      createRoot((d) => {
        dispose = d;

        const store = createSignalBasedStore();

        const safeComputed = computed(() => {
          const sidebar = store.sidebarComponent();
          if (!sidebar) return 'no-sidebar';
          if (sidebar.width === undefined) return 'no-width';
          if (sidebar.width < 200) return 'narrow';
          return 'normal';
        });

        expect(safeComputed()).toBe('no-sidebar');

        store.sidebarComponent.set({});
        expect(safeComputed()).toBe('no-width');

        store.sidebarComponent.set({ width: 150 });
        expect(safeComputed()).toBe('narrow');

        store.sidebarComponent.set({ width: 300 });
        expect(safeComputed()).toBe('normal');
      });
    });

    it('handles circular references in store', () => {
      createRoot((d) => {
        dispose = d;

        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const valueA = signal(1);
        const valueB = signal(2);

        // Create potential circular dependency
        const computedA = computed(() => valueA() + (valueB() > 10 ? computedB() : 0));
        const computedB = computed(() => valueB() + (valueA() > 10 ? computedA() : 0));

        const store = {
          a: computedA,
          b: computedB,
          setA: (v: number) => valueA.set(v),
          setB: (v: number) => valueB.set(v),
        };

        // Should work fine when no circular dependency is triggered
        expect(store.a()).toBe(1);
        expect(store.b()).toBe(2);

        // Trigger potential circular dependency
        store.setA(11);
        store.setB(11);

        // Should handle gracefully (might warn/error)
        expect(() => store.a()).toThrow();

        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      });
    });
  });
});
