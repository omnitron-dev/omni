/**
 * Show - Conditional Rendering Component
 *
 * This component properly handles dynamic conditions by always rendering
 * a container and using effect() to toggle visibility.
 *
 * ✅ WORKS with dynamic conditions:
 * ```tsx
 * const isVisible = signal(false);
 * <Show when={() => isVisible()}>Content</Show>  // Updates when signal changes!
 * ```
 *
 * ✅ WORKS with static conditions:
 * ```tsx
 * const user = { name: 'Alice' };
 * <Show when={user}>Hello {user.name}</Show>
 * ```
 *
 * The component creates a wrapper div that is always in the DOM,
 * and uses display:none to hide/show content based on the condition.
 */

import { defineComponent } from '../core/component/define.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

/**
 * Show component props
 */
export interface ShowProps {
  /**
   * Condition to evaluate - can be a value or a function returning a value
   */
  when: any | (() => any);

  /**
   * Fallback to render when condition is falsy
   */
  fallback?: any;

  /**
   * Children to render when condition is truthy
   */
  children?: any;
}

/**
 * Evaluates the when condition
 */
function evaluateCondition(when: any | (() => any)): boolean {
  const value = typeof when === 'function' ? when() : when;
  return !!value;
}

/**
 * Show component - conditional rendering with proper reactivity
 *
 * @example
 * ```tsx
 * // Dynamic condition with signal
 * const isLoading = signal(true);
 * <Show when={() => isLoading()} fallback={<div>Loaded!</div>}>
 *   <div>Loading...</div>
 * </Show>
 *
 * // Static condition
 * <Show when={user} fallback={<div>No user</div>}>
 *   <div>Hello {user.name}</div>
 * </Show>
 * ```
 */
export const Show = defineComponent<ShowProps>((props) => () => {
  // Always create containers for both children and fallback
  const contentWrapper = jsx('div', {
    'data-show-content': '',
    style: { display: 'contents' }, // Use display:contents to not affect layout
  }) as HTMLElement;

  const fallbackWrapper = jsx('div', {
    'data-show-fallback': '',
    style: { display: 'contents' }, // Use display:contents to not affect layout
  }) as HTMLElement;

  // Process children - handle function children
  const processChildren = (when: any) => {
    if (typeof props.children === 'function') {
      return props.children(when);
    }
    return props.children;
  };

  // Add content to wrappers
  if (props.children !== undefined) {
    const whenValue = typeof props.when === 'function' ? props.when() : props.when;
    const content = processChildren(whenValue);

    if (content !== null && content !== undefined) {
      if (Array.isArray(content)) {
        content.forEach((child) => contentWrapper.appendChild(child));
      } else if (typeof content === 'string' || typeof content === 'number') {
        contentWrapper.textContent = String(content);
      } else if (content instanceof Node) {
        contentWrapper.appendChild(content);
      }
    }
  }

  if (props.fallback !== undefined) {
    if (Array.isArray(props.fallback)) {
      props.fallback.forEach((child) => fallbackWrapper.appendChild(child));
    } else if (typeof props.fallback === 'string' || typeof props.fallback === 'number') {
      fallbackWrapper.textContent = String(props.fallback);
    } else if (props.fallback instanceof Node) {
      fallbackWrapper.appendChild(props.fallback);
    }
  }

  // Create main container that holds both
  const container = jsx('div', {
    'data-show-container': '',
    style: { display: 'contents' }, // Use display:contents to not affect layout
  }) as HTMLElement;

  container.appendChild(contentWrapper);
  container.appendChild(fallbackWrapper);

  // Set up reactive effect to toggle visibility
  effect(() => {
    const condition = evaluateCondition(props.when);

    // Update visibility based on condition
    if (condition) {
      contentWrapper.style.display = 'contents';
      fallbackWrapper.style.display = 'none';
    } else {
      contentWrapper.style.display = 'none';
      fallbackWrapper.style.display = props.fallback !== undefined ? 'contents' : 'none';
    }

    // Update data attributes for testing/debugging
    container.setAttribute('data-show-state', condition ? 'true' : 'false');
  });

  return container;
});
