/**
 * MDX Provider
 *
 * Context provider for MDX components and runtime configuration
 */

import { createContext, provideContext, useContext } from '../../core/component/context.js';
import { defineComponent } from '../../core/component/define.js';
import { signal, computed, effect } from '../../core/reactivity/index.js';
import { jsx } from '../../jsx-runtime.js';

// Import Aether primitives for default components
import { Box } from '../../primitives/Box.js';
import { Code } from '../../primitives/Code.js';

import type { MDXContextValue, MDXProviderProps, MDXComponents, Signal, Component } from '../types.js';

/**
 * Default MDX components
 */
const DEFAULT_COMPONENTS: MDXComponents = {
  // Map HTML elements to Aether primitives
  div: Box,
  code: Code,
  pre: (props: any) => jsx(Code, { ...props, block: true }),

  // Headings
  h1: (props: any) => jsx('h1', { ...props, class: 'mdx-h1' }),
  h2: (props: any) => jsx('h2', { ...props, class: 'mdx-h2' }),
  h3: (props: any) => jsx('h3', { ...props, class: 'mdx-h3' }),
  h4: (props: any) => jsx('h4', { ...props, class: 'mdx-h4' }),
  h5: (props: any) => jsx('h5', { ...props, class: 'mdx-h5' }),
  h6: (props: any) => jsx('h6', { ...props, class: 'mdx-h6' }),

  // Text formatting
  p: (props: any) => jsx('p', { ...props, class: 'mdx-p' }),
  strong: (props: any) => jsx('strong', { ...props, class: 'mdx-strong' }),
  em: (props: any) => jsx('em', { ...props, class: 'mdx-em' }),
  blockquote: (props: any) => jsx('blockquote', { ...props, class: 'mdx-blockquote' }),

  // Lists
  ul: (props: any) => jsx('ul', { ...props, class: 'mdx-ul' }),
  ol: (props: any) => jsx('ol', { ...props, class: 'mdx-ol' }),
  li: (props: any) => jsx('li', { ...props, class: 'mdx-li' }),

  // Links and media
  a: (props: any) => jsx('a', { ...props, class: 'mdx-link' }),
  img: (props: any) => jsx('img', { ...props, class: 'mdx-img', loading: 'lazy' }),

  // Tables
  table: (props: any) => jsx('table', { ...props, class: 'mdx-table' }),
  thead: (props: any) => jsx('thead', { ...props, class: 'mdx-thead' }),
  tbody: (props: any) => jsx('tbody', { ...props, class: 'mdx-tbody' }),
  tr: (props: any) => jsx('tr', { ...props, class: 'mdx-tr' }),
  th: (props: any) => jsx('th', { ...props, class: 'mdx-th' }),
  td: (props: any) => jsx('td', { ...props, class: 'mdx-td' }),

  // Horizontal rule
  hr: () => jsx('hr', { class: 'mdx-hr' }),
};

/**
 * MDX Context
 */
const MDXContext = createContext<MDXContextValue>({
  components: DEFAULT_COMPONENTS,
  scope: {},
  reactiveScope: {},
});

/**
 * Hook to use MDX context
 */
export function useMDXContext(): MDXContextValue {
  const context = useContext(MDXContext);
  if (!context) {
    // Return default context if not provided
    return {
      components: DEFAULT_COMPONENTS,
      scope: {},
      reactiveScope: {},
    };
  }
  return context;
}

/**
 * MDX Provider Component
 */
export const MDXProvider = defineComponent<MDXProviderProps>((props) => {
  // Create reactive scope
  const reactiveScope: Record<string, Signal<any> | (() => any)> = {};

  // Add utilities to reactive scope
  reactiveScope.signal = signal as any;
  reactiveScope.computed = computed as any;
  reactiveScope.effect = effect as any;

  // Convert scope properties to reactive if needed
  if (props.scope) {
    for (const [key, value] of Object.entries(props.scope)) {
      if (typeof value === 'function' && 'peek' in value) {
        // Already a signal
        reactiveScope[key] = value as Signal<any>;
      } else {
        // Wrap in computed for reactive access
        reactiveScope[key] = computed(() => props.scope![key]);
      }
    }
  }

  // Merge components
  const components = {
    ...DEFAULT_COMPONENTS,
    ...props.components,
  };

  // Create context value
  const contextValue: MDXContextValue = {
    components,
    scope: props.scope || {},
    reactiveScope,
    onError: props.onError,
    onNavigate: props.onNavigate,
  };

  // Provide context
  provideContext(MDXContext, contextValue);

  // Return render function
  return () => props.children;
});

/**
 * Create MDX scope with reactive values
 */
export function createMDXScope(values: Record<string, any>): Record<string, Signal<any>> {
  const scope: Record<string, Signal<any>> = {};

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'function' && 'peek' in value) {
      // Already a signal
      scope[key] = value as Signal<any>;
    } else {
      // Create signal for value
      scope[key] = signal(value);
    }
  }

  return scope;
}

/**
 * Higher-order component to wrap components with MDX provider
 */
export function withMDXProvider<P extends Record<string, any> = {}>(
  Component: Component<P>,
  mdxProps?: Omit<MDXProviderProps, 'children'>
): Component<P> {
  return defineComponent<P>((props) => {
    // Provide MDX context
    provideContext(MDXContext, {
      components: { ...DEFAULT_COMPONENTS, ...mdxProps?.components },
      scope: mdxProps?.scope || {},
      reactiveScope: {},
      onError: mdxProps?.onError,
      onNavigate: mdxProps?.onNavigate,
    });

    // Render component
    return () => jsx(Component as any, props as any);
  });
}

/**
 * Default error handler for MDX
 */
export function defaultMDXErrorHandler(error: Error): void {
  console.error('[MDX Error]:', error);
}

/**
 * Default navigation handler for MDX
 */
export function defaultMDXNavigateHandler(url: string): void {
  // In browser environment
  if (typeof window !== 'undefined') {
    // Check if it's an external URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      window.open(url, '_blank');
    } else {
      // Internal navigation - could integrate with router
      window.location.href = url;
    }
  }
}

// Export context for advanced usage
export { MDXContext };
