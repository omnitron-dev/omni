/**
 * Theme Provider Component
 *
 * Context-based theme provider with:
 * - Theme context for accessing current theme
 * - Runtime theme switching
 * - Nested theme support
 * - SSR compatibility
 */

import { defineComponent, type Component } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, effect, onCleanup, type Signal } from '../core/reactivity/index.js';
import type { Theme } from './defineTheme.js';
import { applyTheme, removeTheme, createThemeVars } from './variables.js';

/**
 * Theme context type
 */
export interface ThemeContextType {
  theme: Signal<Theme>;
  setTheme: (theme: Theme) => void;
  vars: Record<string, string>;
}

/**
 * Theme context
 */
const ThemeContextSymbol = createContext<ThemeContextType | null>(null);

/**
 * Theme provider props
 */
export interface ThemeProviderProps {
  theme: Theme | Signal<Theme>;
  children: any;
  prefix?: string;
  scoped?: boolean;
  element?: HTMLElement;
}

/**
 * Theme Provider Component
 *
 * Provides theme context to child components and applies theme to DOM
 *
 * @example
 * ```typescript
 * import { ThemeProvider } from 'aether/theming';
 * import { lightTheme } from './theme';
 *
 * function App() {
 *   return (
 *     <ThemeProvider theme={lightTheme}>
 *       <div>App content</div>
 *     </ThemeProvider>
 *   );
 * }
 * ```
 */
export const ThemeProvider: Component<ThemeProviderProps> = defineComponent<ThemeProviderProps>((props) => {
  // Convert theme prop to signal if it isn't already
  const themeSignal = computed(() => {
    const themeProp = props.theme;
    return typeof themeProp === 'function' ? themeProp() : themeProp;
  });

  const currentTheme = signal<Theme>(themeSignal());

  // Create theme variables map
  const vars = computed(() => createThemeVars(currentTheme(), props.prefix));

  // Set theme function
  const setTheme = (theme: Theme) => {
    currentTheme.set(theme);
  };

  // Context value
  const contextValue: ThemeContextType = {
    theme: currentTheme as Signal<Theme>,
    setTheme,
    vars: vars(),
  };

  // Apply theme to DOM on mount and when theme changes
  effect(() => {
    const theme = currentTheme();
    const targetElement = props.element;

    if (typeof window !== 'undefined') {
      applyTheme(theme, targetElement, props.prefix);
    }
  });

  // Cleanup theme on unmount
  onCleanup(() => {
    if (typeof window !== 'undefined') {
      removeTheme(props.element, props.prefix);
    }
  });

  // Update when theme prop changes
  effect(() => {
    const newTheme = themeSignal();
    if (newTheme !== currentTheme()) {
      currentTheme.set(newTheme);
    }
  });

  // Provide context
  provideContext(ThemeContextSymbol, contextValue);

  // Render children
  return () => props.children;
});

/**
 * Use theme hook
 *
 * Access current theme from context
 *
 * @returns Theme context
 * @throws Error if used outside ThemeProvider
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { theme, setTheme, vars } = useTheme();
 *
 *   return (
 *     <div style={{ color: vars['colors.primary.500'] }}>
 *       Current theme: {theme().name}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContextSymbol);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}

/**
 * Use theme token hook
 *
 * Get a specific token value from the current theme
 *
 * @param path - Token path (e.g., 'colors.primary.500')
 * @returns Token value signal
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const primaryColor = useThemeToken('colors.primary.500');
 *
 *   return <div style={{ color: primaryColor() }}>Text</div>;
 * }
 * ```
 */
export function useThemeToken(path: string): Signal<any> {
  const { theme } = useTheme();

  return computed(() => {
    const parts = path.split('.');
    let current: any = theme();

    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }

    return current;
  });
}

/**
 * Use theme CSS variable hook
 *
 * Get a CSS variable reference for a token
 *
 * @param path - Token path
 * @returns CSS variable reference
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const primaryVar = useThemeVar('colors.primary.500');
 *
 *   return <div style={{ color: primaryVar }}>Text</div>;
 * }
 * ```
 */
export function useThemeVar(path: string): string {
  const { vars } = useTheme();
  return vars[path] || '';
}

/**
 * With theme HOC
 *
 * Wrap a component with theme context access
 *
 * @param component - Component to wrap
 * @returns Wrapped component with theme prop
 *
 * @example
 * ```typescript
 * const ThemedButton = withTheme((props) => {
 *   const { theme } = props;
 *
 *   return <button>Current theme: {theme().name}</button>;
 * });
 * ```
 */
export function withTheme<P extends Record<string, any>>(
  component: Component<P & { theme: ThemeContextType }>
): Component<P> {
  return defineComponent<P>((props) => {
    const themeContext = useTheme();

    return () =>
      component({
        ...props,
        theme: themeContext,
      });
  });
}

/**
 * Create themed component
 *
 * Create a component that automatically uses theme tokens
 *
 * @param styles - Function that returns styles based on theme
 * @returns Styled component
 *
 * @example
 * ```typescript
 * const ThemedBox = createThemedComponent((theme) => ({
 *   base: {
 *     padding: theme.spacing[4],
 *     backgroundColor: theme.colors.background?.primary,
 *     color: theme.colors.text?.primary,
 *   }
 * }));
 * ```
 */
export function createThemedComponent(
  styles: (theme: Theme) => {
    base?: Record<string, any>;
    variants?: Record<string, any>;
  }
): Component<any> {
  return defineComponent((props) => {
    const { theme } = useTheme();
    const componentStyles = computed(() => styles(theme()));

    return () =>
      // Return a styled component based on theme
      ({
        type: 'div',
        props: {
          ...props,
          style: componentStyles().base,
        },
      });
  });
}

/**
 * Theme toggle hook
 *
 * Helper for toggling between themes (e.g., light/dark)
 *
 * @param themes - Object with theme options
 * @param defaultKey - Default theme key
 * @returns Tuple of [currentKey, toggle function, setTheme function]
 *
 * @example
 * ```typescript
 * function App() {
 *   const [themeKey, toggleTheme] = useThemeToggle({
 *     light: lightTheme,
 *     dark: darkTheme
 *   }, 'light');
 *
 *   return (
 *     <ThemeProvider theme={themeKey === 'light' ? lightTheme : darkTheme}>
 *       <button onClick={toggleTheme}>
 *         Switch to {themeKey === 'light' ? 'dark' : 'light'}
 *       </button>
 *     </ThemeProvider>
 *   );
 * }
 * ```
 */
export function useThemeToggle<K extends string>(
  themes: Record<K, Theme>,
  defaultKey?: K
): [Signal<K>, () => void, (key: K) => void] {
  const keys = Object.keys(themes) as K[];
  const initialKey = defaultKey ?? keys[0];
  if (!initialKey) {
    throw new Error('useThemeToggle requires at least one theme');
  }
  const currentKey = signal<K>(initialKey);

  const { setTheme } = useTheme();

  const toggle = () => {
    const currentIndex = keys.indexOf(currentKey());
    const nextIndex = (currentIndex + 1) % keys.length;
    const nextKey = keys[nextIndex];
    if (nextKey) {
      currentKey.set(nextKey);
      const theme = themes[nextKey];
      if (theme) {
        setTheme(theme);
      }
    }
  };

  const setKey = (key: K) => {
    const theme = themes[key];
    if (theme) {
      currentKey.set(key);
      setTheme(theme);
    }
  };

  return [currentKey, toggle, setKey];
}

/**
 * Create theme index exports
 */
export { ThemeContextSymbol };
