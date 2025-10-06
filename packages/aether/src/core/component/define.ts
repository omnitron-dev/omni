/**
 * Component Definition
 *
 * Core component creation and management
 */

import { getOwner, onCleanup } from '../reactivity/context.js';
import { createRoot } from '../reactivity/batch.js';
import { triggerMount, cleanupComponentContext } from './lifecycle.js';
import { reactiveProps, PROPS_UPDATE } from './props.js';
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
  let render: RenderFunction | undefined;
  let owner: any;
  let reactivePropsInstance: any;
  let isSetupComplete = false;

  // Create component function
  const component: Component<P> = (props: P): any => {
    // First call - run setup
    if (!isSetupComplete) {
      // Wrap props in reactive proxy
      reactivePropsInstance = reactiveProps(props);

      // Create reactive scope for component
      createRoot((rootDispose: () => void) => {
        // Get the owner (reactive context)
        owner = getOwner();

        // Set component name for debugging
        if (name && owner) {
          (owner as any).name = name;
        }

        // Run setup function (once) with reactive props
        render = setup(reactivePropsInstance);

        // Register cleanup
        onCleanup(() => {
          cleanupComponentContext(owner);
          rootDispose();
        });

        return rootDispose;
      });

      isSetupComplete = true;

      // Trigger mount lifecycle
      if (owner) {
        triggerMount(owner);
      }
    } else {
      // Subsequent calls - update props
      if (reactivePropsInstance && reactivePropsInstance[PROPS_UPDATE]) {
        reactivePropsInstance[PROPS_UPDATE](props);
      }
    }

    // Return render result
    // Note: In full implementation, this would integrate with
    // the JSX runtime and create actual DOM elements
    return render!();
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
