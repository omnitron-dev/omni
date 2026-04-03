'use client';

/**
 * Provider Stack Utilities
 *
 * Composable provider pattern for building flexible provider hierarchies.
 *
 * @module @omnitron-dev/prism/core/provider-stack
 */

import type { ReactNode, ComponentType, FC } from 'react';
import { createElement, useMemo } from 'react';

/**
 * A provider component with its props.
 */
export type ProviderEntry<P = Record<string, unknown>> = [ComponentType<P & { children: ReactNode }>, P];

/**
 * A provider that takes only children.
 */
export type SimpleProvider = ComponentType<{ children: ReactNode }>;

/**
 * Provider entry that can be a simple component or a tuple with props.
 */
export type ProviderConfig = SimpleProvider | ProviderEntry;

/**
 * Options for createProviderStack.
 */
export interface ProviderStackOptions {
  /** Display name for debugging */
  displayName?: string;
}

/**
 * Compose multiple providers into a single component.
 * Providers are applied from left to right (first provider wraps outermost).
 *
 * @param providers - Array of providers to compose
 * @returns A single component that renders all providers
 *
 * @example
 * ```tsx
 * const AppProviders = composeProviders([
 *   ThemeProvider,
 *   [AuthProvider, { client: authClient }],
 *   [QueryProvider, { client: queryClient }],
 *   ToastProvider,
 * ]);
 *
 * function App() {
 *   return (
 *     <AppProviders>
 *       <YourApp />
 *     </AppProviders>
 *   );
 * }
 * ```
 */
export function composeProviders(providers: ProviderConfig[]): FC<{ children: ReactNode }> {
  const ComposedProviders: FC<{ children: ReactNode }> = ({ children }) =>
    // Build the provider tree from inside-out (reverse iteration)
    providers.reduceRight<ReactNode>((acc, provider) => {
      if (Array.isArray(provider)) {
        const [Component, props] = provider;
        return createElement(Component, { ...props, children: acc });
      }
      return createElement(provider, { children: acc });
    }, children);
  ComposedProviders.displayName = 'ComposedProviders';
  return ComposedProviders;
}

/**
 * Create a provider stack factory for building customizable provider hierarchies.
 *
 * @param baseProviders - Base providers that are always included
 * @param options - Configuration options
 * @returns A factory function for creating provider components
 *
 * @example
 * ```tsx
 * // Define base stack
 * const createAppProviders = createProviderStack([
 *   ThemeProvider,
 *   [I18nProvider, { locale: 'en' }],
 * ]);
 *
 * // Create with additional providers
 * const AppProviders = createAppProviders({
 *   prepend: [ErrorBoundaryProvider],
 *   append: [ToastProvider, NotificationProvider],
 * });
 *
 * // Or use without modifications
 * const SimpleProviders = createAppProviders();
 * ```
 */
export function createProviderStack(
  baseProviders: ProviderConfig[],
  options: ProviderStackOptions = {}
): (config?: {
  prepend?: ProviderConfig[];
  append?: ProviderConfig[];
  replace?: ProviderConfig[];
}) => FC<{ children: ReactNode }> {
  const { displayName = 'ProviderStack' } = options;

  return (config = {}) => {
    const { prepend = [], append = [], replace } = config;

    const providers = replace ?? [...prepend, ...baseProviders, ...append];
    const Component = composeProviders(providers);
    Component.displayName = displayName;

    return Component;
  };
}

/**
 * Props for ProviderStack component.
 */
export interface ProviderStackProps {
  /** Provider configurations */
  providers: ProviderConfig[];
  /** Child components */
  children: ReactNode;
}

/**
 * ProviderStack - Declarative provider composition component.
 *
 * @example
 * ```tsx
 * function App() {
 *   const providers = useMemo(() => [
 *     ThemeProvider,
 *     [AuthProvider, { client }],
 *     ToastProvider,
 *   ], [client]);
 *
 *   return (
 *     <ProviderStack providers={providers}>
 *       <YourApp />
 *     </ProviderStack>
 *   );
 * }
 * ```
 */
export function ProviderStack({ providers, children }: ProviderStackProps): ReactNode {
  const Provider = useMemo(() => composeProviders(providers), [providers]);
  return <Provider>{children}</Provider>;
}

/**
 * Create a provider component with bound props.
 * Useful for creating reusable provider configurations.
 *
 * @param Provider - The provider component
 * @param props - Props to bind to the provider
 * @returns A new component with bound props
 *
 * @example
 * ```tsx
 * const BoundQueryProvider = withProviderProps(QueryClientProvider, {
 *   client: queryClient,
 * });
 *
 * // Use like a simple provider
 * <BoundQueryProvider>
 *   <App />
 * </BoundQueryProvider>
 * ```
 */
export function withProviderProps<P extends object>(
  Provider: ComponentType<P & { children: ReactNode }>,
  props: P
): SimpleProvider {
  const BoundProvider: SimpleProvider = ({ children }) => createElement(Provider, { ...props, children });

  BoundProvider.displayName = `withProviderProps(${Provider.displayName || Provider.name || 'Component'})`;
  return BoundProvider;
}

/**
 * Create a conditional provider that only renders when condition is true.
 *
 * @param Provider - The provider component
 * @param condition - Whether to render the provider
 * @returns A provider that renders conditionally
 *
 * @example
 * ```tsx
 * const providers = [
 *   ThemeProvider,
 *   conditionalProvider(DevToolsProvider, process.env.NODE_ENV === 'development'),
 *   AuthProvider,
 * ];
 * ```
 */
export function conditionalProvider<P extends { children: ReactNode }>(
  Provider: ComponentType<P>,
  condition: boolean,
  props?: Omit<P, 'children'>
): ProviderConfig | null {
  if (!condition) return null;
  if (props) {
    return [Provider as ComponentType<Record<string, unknown> & { children: ReactNode }>, props];
  }
  return Provider as SimpleProvider;
}

/**
 * Filter out null/undefined providers from a provider array.
 *
 * @param providers - Array of providers that may contain nulls
 * @returns Filtered array of valid providers
 *
 * @example
 * ```tsx
 * const providers = filterProviders([
 *   ThemeProvider,
 *   conditionalProvider(DevToolsProvider, isDev),
 *   conditionalProvider(MockProvider, isMocking),
 *   AuthProvider,
 * ]);
 * ```
 */
export function filterProviders(providers: (ProviderConfig | null | undefined)[]): ProviderConfig[] {
  return providers.filter((p): p is ProviderConfig => p != null);
}
