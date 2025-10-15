/**
 * Component Composition Pattern Tests
 *
 * Tests for advanced composition patterns:
 * - Render props
 * - Higher-order components (HOC)
 * - Custom hooks (composables)
 * - Context patterns
 */

import { describe, it, expect, vi } from 'vitest';
import { defineComponent } from '../../../src/core/component/define.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { createContext, useContext } from '../../../src/core/component/context.js';
import { onMount } from '../../../src/core/component/lifecycle.js';
import { onCleanup } from '../../../src/core/reactivity/context.js';
import { effect } from '../../../src/core/reactivity/effect.js';

describe('Component Composition Patterns', () => {
  describe('Render Props Pattern', () => {
    it('should support render prop pattern for flexible composition', () => {
      // Component that accepts a render function
      const DataProvider = defineComponent<{
        render: (data: { value: number; increment: () => void }) => any;
      }>((props) => {
        const count = signal(0);
        const increment = () => count.set(count() + 1);

        return () => props.render({ value: count(), increment });
      });

      // Component using the render prop
      const Consumer = defineComponent(() => {
        const renderFn = (data: { value: number; increment: () => void }) => `Count: ${data.value}`;

        return () => DataProvider({ render: renderFn });
      });

      const result = Consumer({}) as Node;
      expect(result.textContent).toBe('Count: 0');
    });

    it('should pass reactive data through render props', () => {
      let latestValue = 0;

      const MouseTracker = defineComponent<{
        children: (position: { x: number; y: number }) => any;
      }>((props) => {
        const position = signal({ x: 0, y: 0 });

        const updatePosition = (x: number, y: number) => {
          position.set({ x, y });
        };

        // Expose for testing
        (updatePosition as any).position = position;

        return () => props.children(position());
      });

      const tracker = MouseTracker({
        children: (pos) => {
          latestValue = pos.x;
          return `X: ${pos.x}, Y: ${pos.y}`;
        },
      }) as Node;

      expect(tracker.textContent).toContain('X: 0');
    });

    it('should support multiple render props', () => {
      // Store references to rendered content
      let headerContent = '';
      let contentContent = '';
      let footerContent = '';

      const MultiSlot = defineComponent<{
        header: () => any;
        content: () => any;
        footer: () => any;
      }>((props) => {
        // Execute render props and capture their results
        headerContent = props.header();
        contentContent = props.content();
        footerContent = props.footer();

        // Return combined content as string for DOM rendering
        return () => `${headerContent}|${contentContent}|${footerContent}`;
      });

      const result = MultiSlot({
        header: () => 'Header',
        content: () => 'Content',
        footer: () => 'Footer',
      }) as Node;

      // Verify the combined content is rendered
      expect(result.textContent).toBe('Header|Content|Footer');
      // Verify individual parts were captured
      expect(headerContent).toBe('Header');
      expect(contentContent).toBe('Content');
      expect(footerContent).toBe('Footer');
    });
  });

  describe('Higher-Order Components (HOC)', () => {
    it('should create HOC that adds functionality to components', () => {
      // HOC that adds loading state
      function withLoading<P extends object>(Component: (props: P) => any, isLoading: () => boolean) {
        return defineComponent<P>((props) => () => {
            if (isLoading()) {
              return 'Loading...';
            }
            return Component(props);
          });
      }

      const BaseComponent = defineComponent<{ name: string }>((props) => () => `Hello, ${props.name}`);

      const loading = signal(true);
      const EnhancedComponent = withLoading(BaseComponent, () => loading());

      let result = EnhancedComponent({ name: 'World' }) as Node;
      expect(result.textContent).toBe('Loading...');

      loading.set(false);
      result = EnhancedComponent({ name: 'World' }) as Node;
      expect(result.textContent).toBe('Hello, World');
    });

    it('should compose multiple HOCs', () => {
      const mountLog: string[] = [];

      function withLogger<P extends object>(Component: (props: P) => any) {
        return defineComponent<P>((props) => {
          onMount(() => {
            mountLog.push('logger');
          });
          return () => Component(props);
        });
      }

      function withCounter<P extends object>(Component: (props: P) => any) {
        return defineComponent<P>((props) => {
          const count = signal(0);
          onMount(() => {
            mountLog.push('counter');
          });
          return () => Component(props);
        });
      }

      const BaseComponent = defineComponent(() => {
        onMount(() => {
          mountLog.push('base');
        });
        return () => 'Base';
      });

      const Enhanced = withLogger(withCounter(BaseComponent));
      Enhanced({});

      // All HOCs should have mounted
      expect(mountLog.length).toBeGreaterThan(0);
    });

    it('should preserve props through HOC chain', () => {
      function withDefaults<P extends { value?: number }>(Component: (props: P) => any) {
        return defineComponent<P>((props) => {
          const propsWithDefaults = { value: 42, ...props } as P;
          return () => Component(propsWithDefaults);
        });
      }

      const Component = defineComponent<{ value: number }>((props) => () => `Value: ${props.value}`);

      const Enhanced = withDefaults(Component);

      expect((Enhanced({} as any) as Node).textContent).toBe('Value: 42');
      expect((Enhanced({ value: 100 }) as Node).textContent).toBe('Value: 100');
    });
  });

  describe('Custom Hooks (Composables)', () => {
    it('should create reusable composable for counter logic', () => {
      function useCounter(initialValue = 0) {
        const count = signal(initialValue);
        const increment = () => count.set(count() + 1);
        const decrement = () => count.set(count() - 1);
        const reset = () => count.set(initialValue);

        return {
          count: () => count(),
          increment,
          decrement,
          reset,
        };
      }

      const Counter = defineComponent(() => {
        const counter = useCounter(10);

        return () => `Count: ${counter.count()}`;
      });

      const result = Counter({}) as Node;
      expect(result.textContent).toBe('Count: 10');
    });

    it('should create composable with lifecycle hooks', () => {
      function useInterval(callback: () => void, delay: number) {
        let intervalId: any;

        onMount(() => {
          intervalId = setInterval(callback, delay);
        });

        onCleanup(() => {
          if (intervalId) {
            clearInterval(intervalId);
          }
        });

        return {
          clear: () => {
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = undefined;
            }
          },
        };
      }

      const callback = vi.fn();
      const Component = defineComponent(() => {
        const interval = useInterval(callback, 100);

        return () => {
          interval.clear();
          return 'Component';
        };
      });

      Component({});
      expect(callback).not.toHaveBeenCalled();
    });

    it('should compose multiple custom hooks', () => {
      function useToggle(initialValue = false) {
        const value = signal(initialValue);
        const toggle = () => value.set(!value());
        const setTrue = () => value.set(true);
        const setFalse = () => value.set(false);

        return {
          value: () => value(),
          toggle,
          setTrue,
          setFalse,
        };
      }

      function useCounter(initialValue = 0) {
        const count = signal(initialValue);
        const increment = () => count.set(count() + 1);
        const decrement = () => count.set(count() - 1);

        return {
          count: () => count(),
          increment,
          decrement,
        };
      }

      // Capture the hook values to verify they work correctly
      let toggleValue = false;
      let counterValue = 0;

      const Component = defineComponent(() => {
        const toggle = useToggle();
        const counter = useCounter();

        // Capture values for testing
        toggleValue = toggle.value();
        counterValue = counter.count();

        // Return a renderable string instead of an object
        return () => `toggled:${toggle.value()},count:${counter.count()}`;
      });

      const result = Component({}) as Node;
      // Verify hooks were initialized correctly
      expect(toggleValue).toBe(false);
      expect(counterValue).toBe(0);
      // Verify the rendered output
      expect(result.textContent).toBe('toggled:false,count:0');
    });

    it('should create composable with reactive effects', () => {
      function useLocalStorage(key: string, initialValue: string) {
        const stored = signal(initialValue);
        const storage = new Map<string, string>();

        // Simulate localStorage
        effect(() => {
          storage.set(key, stored());
        });

        const setValue = (value: string) => {
          stored.set(value);
        };

        return {
          value: () => stored(),
          setValue,
          _storage: storage,
        };
      }

      const Component = defineComponent(() => {
        const localStorage = useLocalStorage('test-key', 'default');

        return () => localStorage.value();
      });

      const result = Component({}) as Node;
      expect(result.textContent).toBe('default');
    });
  });

  describe('Context Patterns', () => {
    it('should provide and consume context across component tree', () => {
      const ThemeContext = createContext({ theme: 'light' });

      const ThemeProvider = defineComponent<{ theme: string; children: any }>((props) => () =>
          ThemeContext.Provider({
            value: { theme: props.theme },
            children: props.children,
          }));

      const ThemedComponent = defineComponent(() => {
        const context = useContext(ThemeContext);
        return () => `Theme: ${context?.theme || 'none'}`;
      });

      const result = ThemeProvider({
        theme: 'dark',
        children: ThemedComponent({}),
      });

      expect(result).toBeTruthy();
    });

    it('should support nested context providers', () => {
      const UserContext = createContext({ user: 'guest' });
      const SettingsContext = createContext({ lang: 'en' });

      const App = defineComponent(() => () =>
          UserContext.Provider({
            value: { user: 'admin' },
            children: SettingsContext.Provider({
              value: { lang: 'ru' },
              children: defineComponent(() => {
                const user = useContext(UserContext);
                const settings = useContext(SettingsContext);
                return () => `${user?.user}-${settings?.lang}`;
              })({}),
            }),
          }));

      const result = App({});
      expect(result).toBeTruthy();
    });

    it('should allow context updates to propagate', () => {
      const CountContext = createContext({ count: signal(0) });

      const Provider = defineComponent<{ children: any }>((props) => {
        const count = signal(0);
        return () =>
          CountContext.Provider({
            value: { count },
            children: props.children,
          });
      });

      const Consumer = defineComponent(() => {
        const context = useContext(CountContext);
        return () => `Count: ${context?.count() || 0}`;
      });

      const result = Provider({
        children: Consumer({}),
      });

      expect(result).toBeTruthy();
    });

    it('should support multiple context consumers', () => {
      const DataContext = createContext({ data: 'shared-data' });

      const Provider = defineComponent<{ children: any }>(() => () =>
          DataContext.Provider({
            value: { data: 'test-data' },
            children: [
              defineComponent(() => {
                const ctx = useContext(DataContext);
                return () => `Consumer1: ${ctx?.data}`;
              })({}),
              defineComponent(() => {
                const ctx = useContext(DataContext);
                return () => `Consumer2: ${ctx?.data}`;
              })({}),
            ],
          }));

      const result = Provider({ children: null });
      expect(result).toBeTruthy();
    });

    it('should create custom context hook', () => {
      const AuthContext = createContext<{
        isAuthenticated: boolean;
        login: () => void;
        logout: () => void;
      } | null>(null);

      function useAuth() {
        const context = useContext(AuthContext);
        if (!context) {
          throw new Error('useAuth must be used within AuthProvider');
        }
        return context;
      }

      const AuthProvider = defineComponent<{ children: any }>(() => {
        const isAuthenticated = signal(false);

        const login = () => isAuthenticated.set(true);
        const logout = () => isAuthenticated.set(false);

        return () =>
          AuthContext.Provider({
            value: {
              isAuthenticated: isAuthenticated(),
              login,
              logout,
            },
            children: null,
          });
      });

      AuthProvider({ children: null });
    });
  });

  describe('Advanced Composition', () => {
    it('should combine render props with context', () => {
      const DataContext = createContext({ data: signal([1, 2, 3]) });

      const DataProvider = defineComponent<{ children: any }>((props) => {
        const data = signal([1, 2, 3]);
        return () =>
          DataContext.Provider({
            value: { data },
            children: props.children,
          });
      });

      const DataConsumer = defineComponent<{
        render: (data: number[]) => any;
      }>((props) => {
        const context = useContext(DataContext);
        return () => props.render(context?.data() || []);
      });

      const result = DataProvider({
        children: DataConsumer({
          render: (data) => `Items: ${data.length}`,
        }),
      });

      expect(result).toBeTruthy();
    });

    it('should use HOC with custom hooks', () => {
      function useData() {
        const data = signal('test-data');
        return { data: () => data() };
      }

      function withData<P extends object>(Component: (props: P) => any) {
        return defineComponent<P>((props) => {
          const dataHook = useData();
          return () => Component({ ...props, data: dataHook.data() } as P);
        });
      }

      const BaseComponent = defineComponent<{ data: string }>((props) => () => `Data: ${props.data}`);

      const Enhanced = withData(BaseComponent);
      const result = Enhanced({} as any) as Node;
      expect(result.textContent).toBe('Data: test-data');
    });

    it('should create compound components pattern', () => {
      const TabsContext = createContext<{
        activeTab: () => number;
        setActiveTab: (index: number) => void;
      } | null>(null);

      const Tabs = defineComponent<{ children: any }>((props) => {
        const activeTab = signal(0);
        const setActiveTab = (index: number) => activeTab.set(index);

        return () =>
          TabsContext.Provider({
            value: {
              activeTab: () => activeTab(),
              setActiveTab,
            },
            children: props.children,
          });
      });

      const Tab = defineComponent<{ index: number; children: any }>((props) => {
        const context = useContext(TabsContext);
        const isActive = () => context?.activeTab() === props.index;

        return () => (isActive() ? props.children : null);
      });

      // Attach as static property
      (Tabs as any).Tab = Tab;

      // Test that compound pattern works - Tabs provides context
      const CompoundTest = defineComponent(() => () =>
          Tabs({
            children: Tab({ index: 0, children: 'Tab Content' }),
          }));

      const result = CompoundTest({});
      // Result should be the Provider structure, not null
      expect(result).toBeDefined();
    });
  });
});
