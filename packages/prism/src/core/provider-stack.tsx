'use client';

/**
 * Provider Stack Utilities
 *
 * Composable provider pattern for building flexible provider hierarchies.
 *
 * @module core/provider-stack
 */

import type { ReactNode, ComponentType, ComponentProps, FC } from 'react';
import { createElement } from 'react';

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

type AnyProvider = ComponentType<any>;
type RuntimeProvider = SimpleProvider | readonly [AnyProvider, object];
type EntryProps<Entry> = Entry extends readonly [infer Provider extends AnyProvider, object]
  ? readonly [Provider, Omit<ComponentProps<Provider>, 'children'>]
  : SimpleProvider;
type ProviderList<List extends readonly RuntimeProvider[]> = List & {
  readonly [K in keyof List]: EntryProps<NoInfer<List[K]>>;
};
function hasProps(entry: RuntimeProvider): entry is readonly [AnyProvider, object] {
  return Array.isArray(entry);
}

function renderProviders(providers: readonly RuntimeProvider[], children: ReactNode): ReactNode {
  return providers.reduceRight<ReactNode>((child, entry) => hasProps(entry)
    ? createElement(entry[0], { ...entry[1], children: child })
    : createElement(entry, { children: child }), children);
}

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
export function composeProviders<const C extends readonly RuntimeProvider[]>(providers: ProviderList<C>): FC<{ children: ReactNode }> {
  const ComposedProviders: FC<{ children: ReactNode }> = ({ children }) => renderProviders(providers, children);
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
export function createProviderStack<const Base extends readonly RuntimeProvider[]>(
  baseProviders: ProviderList<Base>,
  options: ProviderStackOptions = {}
) {
  const { displayName = 'ProviderStack' } = options;

  return <const Before extends readonly RuntimeProvider[], const After extends readonly RuntimeProvider[], const Replacement extends readonly RuntimeProvider[]>(
    config: { prepend?: ProviderList<Before>; append?: ProviderList<After>; replace?: ProviderList<Replacement> } = {}
  ): FC<{ children: ReactNode }> => {
    const { prepend = [], append = [], replace } = config;

    const providers = replace ?? [...prepend, ...baseProviders, ...append];
    const Component: FC<{ children: ReactNode }> = ({ children }) => renderProviders(providers, children);
    Component.displayName = displayName;

    return Component;
  };
}

/**
 * Props for ProviderStack component.
 */
export interface ProviderStackProps<C extends readonly RuntimeProvider[] = readonly RuntimeProvider[]> {
  /** Provider configurations */
  providers: ProviderList<C>;
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
export function ProviderStack<const C extends readonly RuntimeProvider[]>({ providers, children }: ProviderStackProps<C>): ReactNode {
  return renderProviders(providers, children);
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
