/**
 * Component Definition
 *
 * Core component creation and management
 */

import { getOwner, onCleanup, context, OwnerImpl } from '../reactivity/context.js';
import { triggerMount, cleanupComponentContext, handleComponentError } from './lifecycle.js';
import { reactiveProps } from './props.js';
import type { ComponentSetup, Component, RenderFunction } from './types.js';

/**
 * Define a component from a setup function
 *
 * @param setup - Setup function that returns a render function
 * @param name - Optional component name for debugging
 * @returns Component function
 *
 * @example
 * ```typescript
 * const Counter = defineComponent(() => {
 *   const count = signal(0);
 *
 *   return () => (
 *     <button on:click={() => count.set(count() + 1)}>
 *       {count()}
 *     </button>
 *   );
 * });
 * ```
 */
export function defineComponent<P = {}>(
  setup: ComponentSetup<P>,
  name?: string
): Component<P> {
  // Create component function - each call creates a new instance
  const component: Component<P> = (props: P): any => {
    let render: RenderFunction | undefined;
    let owner: any;

    try {
      // Wrap props in reactive proxy
      const reactivePropsInstance = reactiveProps(props as Record<string, any>);

      // Create owner with parent link (important for error boundaries)
      const parentOwner = getOwner();
      owner = new OwnerImpl(parentOwner);

      // Set component name for debugging
      if (name && owner) {
        (owner as any).name = name;
      }

      // Run setup in component's owner context
      try {
        context.runWithOwner(owner, () => {
          try {
            // Run setup function with reactive props
            // Cast to P since reactiveProps adds internal methods
            render = setup(reactivePropsInstance as P);
          } catch (error) {
            // Handle setup errors
            handleComponentError(owner, error as Error);
            // Don't throw - error was handled
          }

          // Register cleanup
          onCleanup(() => {
            cleanupComponentContext(owner);
            owner.dispose();
          });
        });
      } catch (error) {
        // If error wasn't handled, re-throw
        if (render === undefined) {
          return null;
        }
      }

      // Trigger mount lifecycle
      triggerMount(owner);

      // Return render result with error handling
      // Run render in owner context so children have correct parent

      // If render is undefined (setup failed), return null
      if (!render) {
        return null;
      }

      try {
        return context.runWithOwner(owner, () => {
          try {
            return render!();
          } catch (error) {
            // Handle render errors
            handleComponentError(owner, error as Error);
            // Return fallback or null on render error
            return null;
          }
        });
      } catch (error) {
        // If error wasn't handled, return null
        return null;
      }
    } catch (error) {
      // Catch any errors that weren't handled by error boundaries
      // This is the last resort
      throw error;
    }
  };

  // Set display name
  if (name) {
    component.displayName = name;
  }

  return component;
}

/**
 * Create a component with explicit name
 *
 * @example
 * ```typescript
 * const Counter = component('Counter', () => {
 *   const count = signal(0);
 *   return () => <div>{count()}</div>;
 * });
 * ```
 */
export function component<P = {}>(
  name: string,
  setup: ComponentSetup<P>
): Component<P> {
  return defineComponent(setup, name);
}
