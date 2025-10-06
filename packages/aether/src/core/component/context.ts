/**
 * Component Context API
 *
 * Context for passing data through component tree without props drilling
 */

import { getOwner } from '../reactivity/context.js';

/**
 * Context object
 */
export interface Context<T> {
  id: symbol;
  defaultValue: T;
  Provider: (props: { value: T; children: any }) => any;
}

/**
 * Storage for context values
 * Maps from owner -> context id -> value
 */
const contextStorage = new WeakMap<any, Map<symbol, any>>();

/**
 * Create a new context
 *
 * @param defaultValue - Default value when context is not provided
 * @param name - Optional name for debugging
 * @returns Context object
 *
 * @example
 * ```typescript
 * interface Theme {
 *   primary: string;
 *   secondary: string;
 * }
 *
 * const ThemeContext = createContext<Theme>({
 *   primary: '#007bff',
 *   secondary: '#6c757d'
 * });
 *
 * // Provider
 * const App = defineComponent(() => {
 *   return () => (
 *     <ThemeContext.Provider value={{ primary: '#ff0000', secondary: '#00ff00' }}>
 *       <MyComponent />
 *     </ThemeContext.Provider>
 *   );
 * });
 *
 * // Consumer
 * const MyComponent = defineComponent(() => {
 *   const theme = useContext(ThemeContext);
 *
 *   return () => <div style={{ color: theme.primary }}>Hello</div>;
 * });
 * ```
 */
export function createContext<T>(
  defaultValue: T,
  name?: string
): Context<T> {
  const id = Symbol(name || 'context');

  const Provider = (props: { value: T; children: any }): any => {
    const owner = getOwner();
    if (!owner) {
      throw new Error('Context.Provider must be used inside a component');
    }

    // Store context value for this owner
    let ownerContexts = contextStorage.get(owner);
    if (!ownerContexts) {
      ownerContexts = new Map();
      contextStorage.set(owner, ownerContexts);
    }
    ownerContexts.set(id, props.value);

    // Return children (in full implementation, this would render them)
    return props.children;
  };

  return {
    id,
    defaultValue,
    Provider,
  };
}

/**
 * Access context value
 *
 * @param context - Context to read from
 * @returns Context value
 * @throws Error if used outside component
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   const theme = useContext(ThemeContext);
 *
 *   return () => <div>{theme.primary}</div>;
 * });
 * ```
 */
export function useContext<T>(context: Context<T>): T {
  const owner = getOwner();
  if (!owner) {
    throw new Error('useContext can only be called inside component setup');
  }

  // Walk up owner chain to find context
  let current = owner;
  while (current) {
    const contexts = contextStorage.get(current);
    if (contexts?.has(context.id)) {
      return contexts.get(context.id) as T;
    }

    // Move to parent owner
    // In full implementation, owner would have a parent property
    // For now, break after first check
    current = (current as any).parent;
    if (!current) break;
  }

  // Return default value if not found
  return context.defaultValue;
}
