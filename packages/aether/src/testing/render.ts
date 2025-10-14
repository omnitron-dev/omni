/**
 * Component Rendering Utilities
 */

/// <reference path="../jsx-types.d.ts" />

import type { RenderOptions, RenderResult, Matcher, MatcherOptions } from './types.js';
import { createRoot } from '../core/reactivity/batch.js';
import { createQueries } from './queries.js';

let mountedContainers = new Set<HTMLElement>();

/**
 * Render a component for testing
 */
export function render(
  ui: () => JSX.Element,
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

  const mount = (component: () => JSX.Element) => {
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
      if (result && typeof result === 'object') {
        if (result.el) {
          container.appendChild(result.el);
        } else if (result instanceof Node) {
          container.appendChild(result);
        }
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
    rerender: (newUi: () => JSX.Element) => {
      if (dispose) dispose();
      container.innerHTML = '';
      mount(newUi);
    },
    unmount: () => {
      if (dispose) dispose();
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
