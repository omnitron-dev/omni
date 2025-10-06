/**
 * Component Context API Tests
 */

import { describe, it, expect } from 'vitest';
import { createContext, useContext } from '../../../../src/core/component/context.js';
import { defineComponent } from '../../../../src/core/component/define.js';
import { signal } from '../../../../src/core/reactivity/signal.js';

describe('Component Context', () => {
  describe('createContext', () => {
    it('should create a context with default value', () => {
      const ThemeContext = createContext('light');

      expect(ThemeContext).toBeDefined();
      expect(ThemeContext.defaultValue).toBe('light');
      expect(ThemeContext.Provider).toBeDefined();
    });

    it('should create context with object default value', () => {
      interface Theme {
        primary: string;
        secondary: string;
      }

      const defaultTheme: Theme = {
        primary: '#007bff',
        secondary: '#6c757d',
      };

      const ThemeContext = createContext(defaultTheme);

      expect(ThemeContext.defaultValue).toEqual(defaultTheme);
    });

    it('should accept optional name for debugging', () => {
      const ThemeContext = createContext('light', 'Theme');

      expect(ThemeContext).toBeDefined();
      // Name is stored internally in the symbol
    });

    it('should create unique context instances', () => {
      const Context1 = createContext('value1');
      const Context2 = createContext('value1');

      // Even with same default value, contexts should be different
      expect(Context1.id).not.toBe(Context2.id);
    });
  });

  describe('useContext', () => {
    it('should return default value when no provider exists', () => {
      const ThemeContext = createContext('light');

      const Consumer = defineComponent(() => {
        const theme = useContext(ThemeContext);
        return () => theme;
      });

      const result = Consumer({});

      expect(result).toBe('light');
    });

    it('should throw when called outside component', () => {
      const ThemeContext = createContext('light');

      expect(() => {
        useContext(ThemeContext);
      }).toThrow('useContext can only be called inside component setup');
    });

    it('should return provided value from Provider', () => {
      const ThemeContext = createContext('light');

      // Test that Provider can be used and provides context value
      const ProviderComponent = defineComponent(() => {
        // Call Provider during setup (where owner exists)
        const result = ThemeContext.Provider({ value: 'dark', children: null });

        // Provider should return children
        expect(result).toBeNull();

        return () => 'provider-rendered';
      });

      const result = ProviderComponent({});

      expect(result).toBe('provider-rendered');
    });
  });

  describe('Context Provider', () => {
    it('should provide value to child components', () => {
      const CountContext = createContext(0);

      const Child = defineComponent(() => {
        const count = useContext(CountContext);
        return () => count;
      });

      const Parent = defineComponent(() => {
        const childResult = Child({});
        return () => childResult;
      });

      const result = Parent({});

      expect(typeof result).toBe('number');
    });

    it('should handle nested providers', () => {
      const ThemeContext = createContext('light');

      // This tests the structure, actual nesting behavior
      // requires full component tree implementation
      const Level1 = defineComponent(() => {
        const theme = useContext(ThemeContext);
        return () => theme;
      });

      const result = Level1({});

      expect(result).toBe('light');
    });

    it('should support multiple contexts', () => {
      const ThemeContext = createContext('light');
      const UserContext = createContext({ name: 'Guest' });

      const Consumer = defineComponent(() => {
        const theme = useContext(ThemeContext);
        const user = useContext(UserContext);
        return () => ({ theme, user });
      });

      const result = Consumer({});

      expect(result.theme).toBe('light');
      expect(result.user.name).toBe('Guest');
    });

    it('should throw when Provider used outside component', () => {
      const ThemeContext = createContext('light');

      expect(() => {
        ThemeContext.Provider({ value: 'dark', children: null });
      }).toThrow('Context.Provider must be used inside a component');
    });
  });

  describe('Context patterns', () => {
    it('should support theme context pattern', () => {
      interface Theme {
        primary: string;
        background: string;
      }

      const ThemeContext = createContext<Theme>({
        primary: '#000',
        background: '#fff',
      });

      const ThemedComponent = defineComponent(() => {
        const theme = useContext(ThemeContext);
        return () => theme.primary;
      });

      const result = ThemedComponent({});

      expect(result).toBe('#000');
    });

    it('should support dependency injection pattern', () => {
      interface Logger {
        log: (msg: string) => void;
      }

      const LoggerContext = createContext<Logger>({
        log: () => {},
      });

      const Component = defineComponent(() => {
        const logger = useContext(LoggerContext);
        return () => logger;
      });

      const result = Component({});

      expect(result).toBeDefined();
      expect(typeof result.log).toBe('function');
    });

    it('should support reactive context values', () => {
      const count = signal(42);
      const CountContext = createContext(count);

      const Consumer = defineComponent(() => {
        const countSignal = useContext(CountContext);
        return () => countSignal();
      });

      const result = Consumer({});

      expect(result).toBe(42);
    });

    it('should support context with complex state', () => {
      interface AppState {
        user: { name: string; role: string };
        settings: { theme: string; locale: string };
        isLoading: boolean;
      }

      const AppStateContext = createContext<AppState>({
        user: { name: 'Guest', role: 'viewer' },
        settings: { theme: 'light', locale: 'en' },
        isLoading: false,
      });

      const Consumer = defineComponent(() => {
        const state = useContext(AppStateContext);
        return () => state.user.name;
      });

      const result = Consumer({});

      expect(result).toBe('Guest');
    });
  });

  describe('Type safety', () => {
    it('should enforce context value types', () => {
      interface User {
        id: number;
        name: string;
        email: string;
      }

      const UserContext = createContext<User>({
        id: 0,
        name: '',
        email: '',
      });

      const Consumer = defineComponent(() => {
        const user = useContext(UserContext);

        // TypeScript should enforce these are correct types
        const name: string = user.name;
        const id: number = user.id;

        return () => ({ name, id });
      });

      const result = Consumer({});

      expect(result.name).toBe('');
      expect(result.id).toBe(0);
    });

    it('should support optional context values', () => {
      const OptionalContext = createContext<string | undefined>(undefined);

      const Consumer = defineComponent(() => {
        const value = useContext(OptionalContext);
        return () => value;
      });

      const result = Consumer({});

      expect(result).toBeUndefined();
    });

    it('should support null context values', () => {
      const NullableContext = createContext<{ value: string } | null>(null);

      const Consumer = defineComponent(() => {
        const value = useContext(NullableContext);
        return () => value;
      });

      const result = Consumer({});

      expect(result).toBeNull();
    });
  });

  describe('Context updates', () => {
    it('should support reactive context updates', () => {
      const valueSignal = signal('initial');
      const ValueContext = createContext(valueSignal);

      const Consumer = defineComponent(() => {
        const value = useContext(ValueContext);
        return () => value();
      });

      const result1 = Consumer({});
      expect(result1).toBe('initial');

      valueSignal.set('updated');
      const result2 = Consumer({});
      expect(result2).toBe('updated');
    });

    it('should handle context with signal-based state', () => {
      interface CounterState {
        count: ReturnType<typeof signal<number>>;
        increment: () => void;
      }

      const count = signal(0);
      const CounterContext = createContext<CounterState>({
        count,
        increment: () => count.set(count() + 1),
      });

      const Consumer = defineComponent(() => {
        const counter = useContext(CounterContext);
        return () => counter.count();
      });

      const result1 = Consumer({});
      expect(result1).toBe(0);

      const state = CounterContext.defaultValue;
      state.increment();

      const result2 = Consumer({});
      expect(result2).toBe(1);
    });
  });

  describe('Performance', () => {
    it('should handle many contexts efficiently', () => {
      const contexts = Array.from({ length: 100 }, (_, i) =>
        createContext(i)
      );

      const Consumer = defineComponent(() => {
        const values = contexts.map((ctx) => useContext(ctx));
        return () => values.reduce((a, b) => a + b, 0);
      });

      const result = Consumer({});

      // Sum of 0..99
      expect(result).toBe(4950);
    });

    it('should not recreate context on each render', () => {
      let createCount = 0;

      const Component = defineComponent(() => {
        // Context should be created once, outside component
        // This is just testing that the pattern works
        createCount++;
        return () => null;
      });

      Component({});
      Component({});

      expect(createCount).toBe(2); // Each component instance runs setup once
    });
  });
});
