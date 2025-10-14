/**
 * Component Rendering Utilities
 */

import type { RenderOptions, RenderResult } from './types.js';
import { createRoot } from '../core/reactivity/batch.js';
import { createQueries } from './queries.js';

// Type alias for JSX elements (avoid JSX namespace issues in DTS generation)
type JSXElement = any;

const mountedContainers = new Set<HTMLElement>();

/**
 * Render a component for testing
 */
export function render(
  ui: () => JSXElement,
  options: RenderOptions = {}
): RenderResult {
  const {
    container = document.body.appendChild(document.createElement('div')),
    baseElement = container,
    wrapper,
    hydrate = false,
  } = options;

  mountedContainers.add(container);

  let dispose: (() => void) | undefined;
  const currentUi = ui; // Track the current UI function

  const mount = (component: () => JSXElement) => {
    const element = wrapper
      ? wrapper({ children: component() })
      : component();

    dispose = createRoot((disposeFn) => {
      if (hydrate && container.firstChild) {
        // Hydration not fully implemented yet
        console.warn('Hydration mode not fully supported');
      }

      // Render element into container
      const result = element as any;
      if (result != null) {
        if (result instanceof Node) {
          // JSX runtime returns DOM nodes directly (HTMLElement, SVGElement, DocumentFragment)
          container.appendChild(result);
        } else if (typeof result === 'object' && result.el instanceof Node) {
          // Old VNode format with .el property
          container.appendChild(result.el);
        } else if (typeof result === 'object' && result.el) {
          // Fallback for non-Node .el property
          container.appendChild(result.el);
        }
        // Silently ignore null/undefined/primitive results
      }

      return disposeFn;
    });
  };

  mount(ui);

  const queries = createQueries(container);

  const result: RenderResult = {
    container,
    baseElement,
    ...queries,
    rerender: (newUi?: () => JSXElement) => {
      const uiToRender = newUi || currentUi;

      if (dispose) dispose();
      container.innerHTML = '';
      mount(uiToRender);

      // After any rerender, update the queries to reflect new DOM
      const newQueries = createQueries(container);
      Object.assign(result, newQueries);

      // If we rerendered with a temporary UI, automatically restore original after a microtask
      // This allows temporary rerenders in waitFor loops without permanently changing the component
      if (newUi && newUi !== currentUi) {
        Promise.resolve().then(() => {
          // Check if we should restore (only if no other rerender happened)
          if (container.innerHTML !== '') { // Still mounted
            if (dispose) dispose();
            container.innerHTML = '';
            mount(currentUi);
            const restoredQueries = createQueries(container);
            Object.assign(result, restoredQueries);
          }
        });
      }
    },
    unmount: () => {
      if (dispose) dispose();
      container.innerHTML = '';
      mountedContainers.delete(container);
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
    debug: (element = container) => {
      console.log(prettyDOM(element));
    },
  };

  return result;
}

/**
 * Cleanup all mounted components
 */
export function cleanup() {
  mountedContainers.forEach((container) => {
    if (container.parentNode === document.body) {
      document.body.removeChild(container);
    }
    container.innerHTML = '';
  });
  mountedContainers.clear();
}

/**
 * Pretty print DOM element
 */
function prettyDOM(element: HTMLElement, maxLength = 7000): string {
  const html = element.outerHTML || '';
  return html.length > maxLength ? html.substring(0, maxLength) + '...' : html;
}
