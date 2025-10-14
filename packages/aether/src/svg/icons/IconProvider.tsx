/**
 * IconProvider Component
 *
 * Context provider for icon registry and default icon props
 */

import { defineComponent, createContext, useContext, effect, signal } from '../../index.js';
import { IconRegistry, getIconRegistry, type IconSet, type IconSource } from './IconRegistry.js';
import type { SVGIconProps } from '../components/SVGIcon.js';

export interface IconProviderProps {
  // Registry configuration
  registry?: IconRegistry;

  // Icon sets to load
  sets?: Array<{
    name: string;
    url?: string;
    icons?: IconSet;
    prefix?: string;
  }>;

  // Default icon props
  defaults?: Partial<SVGIconProps>;

  // Fallback component or element
  fallback?: any;

  // Loading strategy
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: (error: Error) => void;

  children: any;
}

export interface IconContextValue {
  registry: IconRegistry;
  defaults?: Partial<SVGIconProps>;
  fallback?: any;
}

// Create the context
const IconContext = createContext<IconContextValue | null>(null, 'IconContext');

/**
 * IconProvider component
 *
 * Provides icon registry and configuration to child components
 *
 * @example
 * ```tsx
 * <IconProvider
 *   sets={[
 *     { name: 'app', icons: customIcons },
 *     { name: 'feather', url: '/icons/feather.svg' }
 *   ]}
 *   defaults={{
 *     size: 24,
 *     color: 'currentColor'
 *   }}
 * >
 *   <App />
 * </IconProvider>
 * ```
 */
export const IconProvider = defineComponent<IconProviderProps>((props) => {
  // Use provided registry or get global one
  const registry = props.registry || getIconRegistry();
  const isLoaded = signal(false);
  const loadError = signal<Error | null>(null);

  // Load icon sets
  effect(() => {
    (async () => {
      if (!props.sets || props.sets.length === 0) {
        isLoaded.set(true);
        props.onLoad?.();
        return;
      }

      try {
        const loadPromises = props.sets.map(async (set) => {
          if (set.icons) {
            // Register inline icon set
            registry.registerSet(set.name, set.icons, set.prefix);
          } else if (set.url) {
            // Register URL-based icon source
            const source: IconSource = {
              name: set.name,
              type: 'sprite',
              source: set.url,
              prefix: set.prefix,
              lazy: props.loading === 'lazy',
            };
            registry.register(source);
          }
        });

        await Promise.all(loadPromises);
        isLoaded.set(true);
        props.onLoad?.();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        loadError.set(err);
        props.onError?.(err);
      }
    })();
  });

  // Create context value
  const contextValue: IconContextValue = {
    registry,
    defaults: props.defaults,
    fallback: props.fallback,
  };

  return () => (
    <IconContext.Provider value={contextValue}>
      {props.children}
    </IconContext.Provider>
  );
});

/**
 * Hook to access icon registry from context
 *
 * @returns IconRegistry instance
 * @throws Error if used outside IconProvider
 *
 * @example
 * ```tsx
 * const MyComponent = defineComponent(() => {
 *   const registry = useIcons();
 *
 *   effect(async () => {
 *     const icon = await registry.get('heart');
 *     console.log('Heart icon:', icon);
 *   });
 *
 *   return () => <div>Check console for icon</div>;
 * });
 * ```
 */
export function useIcons(): IconRegistry {
  const context = useContext(IconContext);

  if (!context) {
    // Fallback to global registry if no provider
    return getIconRegistry();
  }

  return context.registry;
}

/**
 * Hook to access icon defaults from context
 *
 * @returns Default icon props or empty object
 *
 * @example
 * ```tsx
 * const MyComponent = defineComponent(() => {
 *   const defaults = useIconDefaults();
 *
 *   return () => (
 *     <SVGIcon
 *       name="heart"
 *       size={defaults.size}
 *       color={defaults.color}
 *     />
 *   );
 * });
 * ```
 */
export function useIconDefaults(): Partial<SVGIconProps> {
  const context = useContext(IconContext);
  return context?.defaults || {};
}

/**
 * Hook to access icon fallback from context
 *
 * @returns Fallback component or element
 *
 * @example
 * ```tsx
 * const MyComponent = defineComponent(() => {
 *   const fallback = useIconFallback();
 *
 *   return () => fallback || <div>No fallback</div>;
 * });
 * ```
 */
export function useIconFallback(): any {
  const context = useContext(IconContext);
  return context?.fallback;
}

/**
 * Hook to get icon context value
 *
 * @returns Full icon context or null
 */
export function useIconContext(): IconContextValue | null {
  return useContext(IconContext);
}
