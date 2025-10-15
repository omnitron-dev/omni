/**
 * For - List Rendering Component
 *
 * Efficiently renders lists with proper reactivity.
 * This component handles dynamic list changes by maintaining a container
 * and updating its children using effects.
 */

import { defineComponent } from '../core/component/define.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

/**
 * For component props
 */
export interface ForProps<T> {
  /**
   * Array of items to render - can be a signal function or static array
   */
  each: T[] | (() => T[] | undefined | null) | undefined | null;

  /**
   * Fallback to render when list is empty
   */
  fallback?: any;

  /**
   * Children render function
   * Receives (item, index)
   */
  children: (item: T, index: number) => any;
}

/**
 * Gets the items array from the each prop
 */
function getItems<T>(each: T[] | (() => T[] | undefined | null) | undefined | null): T[] {
  if (typeof each === 'function') {
    const result = each();
    return result || [];
  }
  return each || [];
}

/**
 * For component - efficient list rendering with proper reactivity
 *
 * Maintains DOM nodes for list items and updates them reactively.
 *
 * @example
 * ```tsx
 * const todos = signal([
 *   { id: 1, text: 'Learn Aether' },
 *   { id: 2, text: 'Build app' }
 * ]);
 *
 * <For each={() => todos()} fallback={<div>No todos</div>}>
 *   {(todo, index) => (
 *     <div>
 *       {index + 1}. {todo.text}
 *     </div>
 *   )}
 * </For>
 * ```
 */
export const For = defineComponent(<T>(props: ForProps<T>) => () => {
  // Create container for list items
  const listContainer = jsx('div', {
    'data-for-list': '',
    style: { display: 'contents' },
  }) as HTMLElement;

  // Create container for fallback
  const fallbackContainer = jsx('div', {
    'data-for-fallback': '',
    style: { display: 'contents' },
  }) as HTMLElement;

  // Add fallback content if provided
  if (props.fallback !== undefined) {
    if (Array.isArray(props.fallback)) {
      props.fallback.forEach((child) => fallbackContainer.appendChild(child));
    } else if (typeof props.fallback === 'string' || typeof props.fallback === 'number') {
      fallbackContainer.textContent = String(props.fallback);
    } else if (props.fallback instanceof Node) {
      fallbackContainer.appendChild(props.fallback);
    }
  }

  // Main container that holds both list and fallback
  const container = jsx('div', {
    'data-for-container': '',
    style: { display: 'contents' },
  }) as HTMLElement;

  container.appendChild(listContainer);
  container.appendChild(fallbackContainer);

  // Map to track rendered items by key/index
  const renderedItems = new Map<number, Node>();

  // Initial count setup - do this before effect
  const initialItems = getItems(props.each);
  container.setAttribute('data-for-count', String(initialItems.length));

  // Set up reactive effect to update list
  effect(() => {
    const items = getItems(props.each);
    const hasItems = items.length > 0;

    // Update visibility
    if (hasItems) {
      listContainer.style.display = 'contents';
      fallbackContainer.style.display = 'none';
    } else {
      listContainer.style.display = 'none';
      fallbackContainer.style.display = props.fallback !== undefined ? 'contents' : 'none';
    }

    // Update data attribute for testing
    container.setAttribute('data-for-count', String(items.length));

    // Clear all existing children from listContainer
    // This prevents duplicates and ensures clean re-render
    while (listContainer.firstChild) {
      listContainer.removeChild(listContainer.firstChild);
    }

    // Clear the rendered items map
    renderedItems.clear();

    // Render all items fresh (since we cleared the list)
    items.forEach((item, index) => {
      // Render new item - always create wrapper even for null/undefined
      const itemWrapper = document.createElement('div');
      itemWrapper.style.display = 'contents';
      itemWrapper.setAttribute('data-for-item', String(index));

      const rendered = props.children(item, index);

      // Append content to wrapper (even if null/undefined)
      if (rendered !== null && rendered !== undefined) {
        if (Array.isArray(rendered)) {
          rendered.forEach((child) => {
            if (child instanceof Node) {
              itemWrapper.appendChild(child);
            } else if (typeof child === 'string' || typeof child === 'number') {
              itemWrapper.appendChild(document.createTextNode(String(child)));
            }
          });
        } else if (rendered instanceof Node) {
          itemWrapper.appendChild(rendered);
        } else if (typeof rendered === 'string' || typeof rendered === 'number') {
          itemWrapper.appendChild(document.createTextNode(String(rendered)));
        }
      }

      // Add to list container
      listContainer.appendChild(itemWrapper);

      // Track rendered item
      renderedItems.set(index, itemWrapper);
    });
  });

  return container;
}) as <T>(props: ForProps<T>) => any;
