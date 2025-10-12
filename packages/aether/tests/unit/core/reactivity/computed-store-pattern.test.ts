/**
 * Tests for computed values with store patterns and nested signals
 */

import { it, vi, expect, describe, afterEach, beforeEach } from 'vitest';
import { signal, computed, effect, createRoot } from '../../../../src/core/reactivity/index.js';

describe('Computed with Store Pattern', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  describe('Problem: computed not tracking store signals', () => {
    it('SHOULD FAIL: computed with function returning signal value does not track changes', () => {
      createRoot((d) => {
        dispose = d;

        // Create a store with a signal inside
        const store = {
          _signal: signal({ focused: false }),
          // This returns the VALUE, not the signal itself
          sidebarComponent: () => store._signal(),
        };

        // Computed that uses the store pattern
        const theme = computed(() => {
          // This pattern won't track changes!
          return store.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        expect(theme()).toBe('muted');

        // Change the signal value
        store._signal.set({ focused: true });

        // This will likely FAIL - computed won't update
        // because sidebarComponent() is not a signal call
        expect(theme()).toBe('accent'); // This might still be 'muted'!
      });
    });

    it('SHOULD FAIL: effect with function returning signal value does not track changes', async () => {
      await new Promise<void>((resolve) => {
        createRoot((d) => {
          dispose = d;

          const store = {
            _signal: signal({ focused: false }),
            sidebarComponent: () => store._signal(),
          };

          const results: string[] = [];
          effect(() => {
            const theme = store.sidebarComponent()?.focused ? 'accent' : 'muted';
            results.push(theme);
          });

          expect(results).toEqual(['muted']);

          // Change the signal
          store._signal.set({ focused: true });

          setTimeout(() => {
            // This might FAIL - effect might not re-run
            expect(results).toEqual(['muted', 'accent']);
            resolve();
          }, 20);
        });
      });
    });
  });

  describe('Solution 1: Return signal itself, not its value', () => {
    it('computed correctly tracks when store returns signal', () => {
      createRoot((d) => {
        dispose = d;

        // Store returns the signal itself
        const store = {
          sidebarComponent: signal<{ focused: boolean } | undefined>({ focused: false }),
        };

        // Computed calls the signal
        const theme = computed(() => {
          return store.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        expect(theme()).toBe('muted');

        // Change the signal
        store.sidebarComponent.set({ focused: true });

        // Now it should work!
        expect(theme()).toBe('accent');
      });
    });

    it('effect correctly tracks when store returns signal', async () => {
      await new Promise<void>((resolve) => {
        createRoot((d) => {
          dispose = d;

          const store = {
            sidebarComponent: signal<{ focused: boolean } | undefined>({ focused: false }),
          };

          const results: string[] = [];
          effect(() => {
            const theme = store.sidebarComponent()?.focused ? 'accent' : 'muted';
            results.push(theme);
          });

          expect(results).toEqual(['muted']);

          store.sidebarComponent.set({ focused: true });

          setTimeout(() => {
            expect(results).toEqual(['muted', 'accent']);
            resolve();
          }, 20);
        });
      });
    });
  });

  describe('Solution 2: Make store methods call signals internally', () => {
    it('computed tracks when store method calls signal internally', () => {
      createRoot((d) => {
        dispose = d;

        class Store {
          private _sidebarSignal = signal<{ focused: boolean } | undefined>({ focused: false });

          // Method that calls signal internally
          sidebarComponent() {
            return this._sidebarSignal();
          }

          setSidebarComponent(value: { focused: boolean } | undefined) {
            this._sidebarSignal.set(value);
          }
        }

        const store = new Store();

        // This WILL track because sidebarComponent() calls a signal
        const theme = computed(() => {
          return store.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        expect(theme()).toBe('muted');

        store.setSidebarComponent({ focused: true });
        expect(theme()).toBe('accent');

        store.setSidebarComponent(undefined);
        expect(theme()).toBe('muted');
      });
    });
  });

  describe('Solution 3: Use computed in store', () => {
    it('nested computed values track correctly', () => {
      createRoot((d) => {
        dispose = d;

        class Store {
          private _sidebarSignal = signal<{ focused: boolean } | undefined>({ focused: false });

          // Store provides a computed
          sidebarComponent = computed(() => this._sidebarSignal());

          setSidebarComponent(value: { focused: boolean } | undefined) {
            this._sidebarSignal.set(value);
          }
        }

        const store = new Store();

        // Computed that depends on another computed
        const theme = computed(() => {
          return store.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        expect(theme()).toBe('muted');

        store.setSidebarComponent({ focused: true });
        expect(theme()).toBe('accent');
      });
    });
  });

  describe('Complex nested store patterns', () => {
    it('tracks changes through multiple levels of nesting', () => {
      createRoot((d) => {
        dispose = d;

        // Multi-level store structure
        const userPrefs = signal({ darkMode: false, notifications: true });
        const sidebarState = signal({ focused: false, width: 300 });

        const store = {
          user: computed(() => ({
            preferences: userPrefs(),
          })),
          sidebar: computed(() => sidebarState()),
        };

        // Complex computed with multiple dependencies
        const theme = computed(() => {
          const isDark = store.user().preferences.darkMode;
          const isFocused = store.sidebar().focused;

          if (isDark && isFocused) return 'dark-accent';
          if (isDark) return 'dark-muted';
          if (isFocused) return 'light-accent';
          return 'light-muted';
        });

        expect(theme()).toBe('light-muted');

        // Change sidebar focus
        sidebarState.set({ ...sidebarState(), focused: true });
        expect(theme()).toBe('light-accent');

        // Change dark mode
        userPrefs.set({ ...userPrefs(), darkMode: true });
        expect(theme()).toBe('dark-accent');

        // Remove focus
        sidebarState.set({ ...sidebarState(), focused: false });
        expect(theme()).toBe('dark-muted');
      });
    });

    it('handles optional chaining with nested signals', () => {
      createRoot((d) => {
        dispose = d;

        const dataSignal = signal<{
          user?: {
            profile?: {
              settings?: {
                theme?: string;
              };
            };
          };
        }>({});

        const store = {
          data: () => dataSignal(),
        };

        const theme = computed(() => {
          return store.data()?.user?.profile?.settings?.theme ?? 'default';
        });

        expect(theme()).toBe('default');

        // Set nested data
        dataSignal.set({
          user: {
            profile: {
              settings: {
                theme: 'dark',
              },
            },
          },
        });

        expect(theme()).toBe('dark');

        // Partial update
        dataSignal.set({
          user: {
            profile: undefined,
          },
        });

        expect(theme()).toBe('default');
      });
    });

    it('tracks array operations in store', () => {
      createRoot((d) => {
        dispose = d;

        const itemsSignal = signal<Array<{ id: number; active: boolean }>>([
          { id: 1, active: false },
          { id: 2, active: false },
        ]);

        const store = {
          items: () => itemsSignal(),
          setItemActive: (id: number, active: boolean) => {
            const items = itemsSignal();
            const updated = items.map((item) => (item.id === id ? { ...item, active } : item));
            itemsSignal.set(updated);
          },
        };

        const activeCount = computed(() => {
          return store.items().filter((item) => item.active).length;
        });

        expect(activeCount()).toBe(0);

        store.setItemActive(1, true);
        expect(activeCount()).toBe(1);

        store.setItemActive(2, true);
        expect(activeCount()).toBe(2);

        store.setItemActive(1, false);
        expect(activeCount()).toBe(1);
      });
    });
  });

  describe('Performance and memoization with store pattern', () => {
    it('only recomputes when relevant store values change', () => {
      createRoot((d) => {
        dispose = d;

        const sidebarSignal = signal({ focused: false, width: 300 });
        const themeSignal = signal('light');
        const userSignal = signal({ name: 'John' });

        const store = {
          sidebar: () => sidebarSignal(),
          theme: () => themeSignal(),
          user: () => userSignal(),
        };

        const computeFn = vi.fn(() => {
          return store.sidebar().focused ? 'accent' : 'muted';
        });

        const theme = computed(computeFn);

        expect(theme()).toBe('muted');
        expect(computeFn).toHaveBeenCalledTimes(1);

        // Change unrelated store value
        themeSignal.set('dark');
        expect(theme()).toBe('muted');
        expect(computeFn).toHaveBeenCalledTimes(1); // Not recomputed

        userSignal.set({ name: 'Jane' });
        expect(theme()).toBe('muted');
        expect(computeFn).toHaveBeenCalledTimes(1); // Still not recomputed

        // Change relevant value
        sidebarSignal.set({ focused: true, width: 300 });
        expect(theme()).toBe('accent');
        expect(computeFn).toHaveBeenCalledTimes(2); // Recomputed
      });
    });
  });

  describe('Error handling in store computeds', () => {
    it('handles errors in computed with store access', () => {
      createRoot((d) => {
        dispose = d;

        const dataSignal = signal<any>(null);

        const store = {
          data: () => dataSignal(),
        };

        const safeComputed = computed(() => {
          try {
            // This might throw if data is null
            return store.data().required.field;
          } catch {
            return 'error-fallback';
          }
        });

        expect(safeComputed()).toBe('error-fallback');

        dataSignal.set({ required: { field: 'value' } });
        expect(safeComputed()).toBe('value');

        dataSignal.set({ different: 'structure' });
        expect(safeComputed()).toBe('error-fallback');
      });
    });
  });

  describe('Subscription patterns with stores', () => {
    it('subscriptions work with store-based computeds', () => {
      createRoot((d) => {
        dispose = d;

        const stateSignal = signal({ count: 0 });

        const store = {
          state: () => stateSignal(),
          increment: () => {
            stateSignal.set({ count: stateSignal().count + 1 });
          },
        };

        const doubled = computed(() => store.state().count * 2);

        const results: number[] = [];
        const unsubscribe = doubled.subscribe((value) => {
          results.push(value);
        });

        // Trigger some changes
        store.increment();
        doubled(); // Need to access to trigger recomputation

        store.increment();
        doubled();

        store.increment();
        doubled();

        expect(results).toEqual([2, 4, 6]);

        unsubscribe();

        store.increment();
        doubled();

        // No new values after unsubscribe
        expect(results).toEqual([2, 4, 6]);
      });
    });
  });

  describe('Getter-based store patterns', () => {
    it('computed tracks changes when store returns object with getters', () => {
      createRoot((d) => {
        dispose = d;

        // Internal signal for focused state
        const focusedSignal = signal(false);

        // Store where sidebarComponent returns object with getter
        const appStore = {
          sidebarComponent: () => ({
            get focused() {
              return focusedSignal();
            },
          }),
        };

        // Computed with optional chaining and getter
        const theme = computed(() => {
          return appStore.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        // Initial value
        expect(theme()).toBe('muted');

        // Change signal - computed should track this
        focusedSignal.set(true);
        expect(theme()).toBe('accent');

        // Change back
        focusedSignal.set(false);
        expect(theme()).toBe('muted');
      });
    });

    it('handles nested getters with optional chaining', () => {
      createRoot((d) => {
        dispose = d;

        const darkModeSignal = signal(false);
        const focusedSignal = signal(false);

        // Store with nested getters
        const appStore = {
          sidebarComponent: () => ({
            get focused() {
              return focusedSignal();
            },
          }),
          user: {
            preferences: {
              get darkMode() {
                return darkModeSignal();
              },
            },
          },
        };

        // Complex computed with multiple getters
        const displayMode = computed(() => {
          const isDark = appStore.user?.preferences?.darkMode;
          const isFocused = appStore.sidebarComponent?.()?.focused;

          if (isDark && isFocused) return 'dark-accent';
          if (isDark) return 'dark-muted';
          if (isFocused) return 'light-accent';
          return 'light-muted';
        });

        expect(displayMode()).toBe('light-muted');

        focusedSignal.set(true);
        expect(displayMode()).toBe('light-accent');

        darkModeSignal.set(true);
        expect(displayMode()).toBe('dark-accent');

        focusedSignal.set(false);
        expect(displayMode()).toBe('dark-muted');
      });
    });

    it('tracks lazy getter evaluation correctly', () => {
      createRoot((d) => {
        dispose = d;

        const focusedSignal = signal(false);
        let getterCallCount = 0;

        const appStore = {
          sidebarComponent: () => ({
            get focused() {
              getterCallCount++;
              return focusedSignal();
            },
          }),
        };

        const theme = computed(() => {
          return appStore.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        // Getter not called until computed is evaluated
        expect(getterCallCount).toBe(0);

        // First evaluation
        expect(theme()).toBe('muted');
        expect(getterCallCount).toBe(1);

        // Cached value used
        expect(theme()).toBe('muted');
        expect(getterCallCount).toBe(1);

        // Change triggers re-evaluation
        focusedSignal.set(true);
        expect(theme()).toBe('accent');
        expect(getterCallCount).toBe(2);
      });
    });

    it('handles getter returning undefined correctly', () => {
      createRoot((d) => {
        dispose = d;

        const componentSignal = signal<{ focused?: boolean } | undefined>(undefined);

        const appStore = {
          sidebarComponent: () => {
            const component = componentSignal();
            if (!component) return undefined;
            return {
              get focused() {
                return component.focused;
              },
            };
          },
        };

        const theme = computed(() => {
          return appStore.sidebarComponent?.()?.focused ? 'accent' : 'muted';
        });

        // undefined component
        expect(theme()).toBe('muted');

        // component without focused
        componentSignal.set({});
        expect(theme()).toBe('muted');

        // component with focused false
        componentSignal.set({ focused: false });
        expect(theme()).toBe('muted');

        // component with focused true
        componentSignal.set({ focused: true });
        expect(theme()).toBe('accent');

        // back to undefined
        componentSignal.set(undefined);
        expect(theme()).toBe('muted');
      });
    });

    it('tracks changes with mixed getter and method patterns', () => {
      createRoot((d) => {
        dispose = d;

        const activeSignal = signal(false);
        const modeSignal = signal<'light' | 'dark'>('light');
        const countSignal = signal(0);

        // Mix of getters, methods, and properties
        const appStore = {
          sidebarComponent: () => ({
            get focused() {
              return activeSignal();
            },
            theme: computed(() => modeSignal()),
            version: '1.0.0',
            getCount: () => countSignal(),
          }),
        };

        const summary = computed(() => {
          const sidebar = appStore.sidebarComponent?.();
          const focused = sidebar?.focused;
          const theme = sidebar?.theme?.();
          const version = sidebar?.version;
          const count = sidebar?.getCount?.();

          return `${focused ? 'active' : 'inactive'}-${theme}-v${version}-${count}`;
        });

        expect(summary()).toBe('inactive-light-v1.0.0-0');

        activeSignal.set(true);
        expect(summary()).toBe('active-light-v1.0.0-0');

        modeSignal.set('dark');
        expect(summary()).toBe('active-dark-v1.0.0-0');

        countSignal.set(5);
        expect(summary()).toBe('active-dark-v1.0.0-5');
      });
    });

    it('only evaluates needed getters for performance', () => {
      createRoot((d) => {
        dispose = d;

        const focusedSignal = signal(false);
        const widthSignal = signal(300);

        let focusedGetterCalls = 0;
        let widthGetterCalls = 0;

        const appStore = {
          sidebarComponent: () => ({
            get focused() {
              focusedGetterCalls++;
              return focusedSignal();
            },
            get width() {
              widthGetterCalls++;
              return widthSignal();
            },
          }),
        };

        const theme = computed(() => {
          return appStore.sidebarComponent()?.focused ? 'accent' : 'muted';
        });

        expect(focusedGetterCalls).toBe(0);
        expect(widthGetterCalls).toBe(0);

        // Only focused getter called
        expect(theme()).toBe('muted');
        expect(focusedGetterCalls).toBe(1);
        expect(widthGetterCalls).toBe(0);

        // Width change doesn't trigger focused getter
        widthSignal.set(400);
        expect(theme()).toBe('muted');
        expect(focusedGetterCalls).toBe(1);
        expect(widthGetterCalls).toBe(0);

        // Focused change triggers re-evaluation
        focusedSignal.set(true);
        expect(theme()).toBe('accent');
        expect(focusedGetterCalls).toBe(2);
        expect(widthGetterCalls).toBe(0);
      });
    });

    it('handles getter throwing errors gracefully', () => {
      createRoot((d) => {
        dispose = d;

        const shouldThrowSignal = signal(false);

        const appStore = {
          sidebarComponent: () => ({
            get focused() {
              if (shouldThrowSignal()) {
                throw new Error('Getter error');
              }
              return false;
            },
          }),
        };

        const theme = computed(() => {
          try {
            return appStore.sidebarComponent()?.focused ? 'accent' : 'muted';
          } catch (e) {
            return 'error';
          }
        });

        expect(theme()).toBe('muted');

        shouldThrowSignal.set(true);
        expect(theme()).toBe('error');

        shouldThrowSignal.set(false);
        expect(theme()).toBe('muted');
      });
    });

    it('effect tracks getter changes correctly', async () => {
      await new Promise<void>((resolve) => {
        createRoot((d) => {
          dispose = d;

          const focusedSignal = signal(false);
          const results: string[] = [];

          const appStore = {
            sidebarComponent: () => ({
              get focused() {
                return focusedSignal();
              },
            }),
          };

          effect(() => {
            const theme = appStore.sidebarComponent()?.focused ? 'accent' : 'muted';
            results.push(theme);
          });

          expect(results).toEqual(['muted']);

          focusedSignal.set(true);

          setTimeout(() => {
            expect(results).toEqual(['muted', 'accent']);

            focusedSignal.set(false);

            setTimeout(() => {
              expect(results).toEqual(['muted', 'accent', 'muted']);
              resolve();
            }, 20);
          }, 20);
        });
      });
    });
  });
});
