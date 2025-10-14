/**
 * Test utilities for Aether framework
 */

import { Component, JSX } from '../src/index';

/**
 * Render a component for testing
 */
export function render(component: Component | (() => JSX.Element)) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  // Execute component function and append to container
  const result = typeof component === 'function' ? component() : component;

  // Simple rendering - in real implementation, this would use the reconciler
  if (typeof result === 'string') {
    container.innerHTML = result;
  } else if (result && typeof result === 'object') {
    // Handle JSX element
    const element = createDOMElement(result);
    if (element) {
      container.appendChild(element);
    }
  }

  return {
    container,
    rerender: (newComponent: Component | (() => JSX.Element)) => {
      container.innerHTML = '';
      const newResult = typeof newComponent === 'function' ? newComponent() : newComponent;
      if (typeof newResult === 'string') {
        container.innerHTML = newResult;
      } else if (newResult && typeof newResult === 'object') {
        const element = createDOMElement(newResult);
        if (element) {
          container.appendChild(element);
        }
      }
    }
  };
}

/**
 * Clean up after tests
 */
export function cleanup() {
  document.body.innerHTML = '';
}

/**
 * Wait for next tick
 */
export function nextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Create DOM element from JSX
 */
function createDOMElement(jsx: any): Element | null {
  if (!jsx) return null;

  // Handle text nodes
  if (typeof jsx === 'string' || typeof jsx === 'number') {
    return document.createTextNode(String(jsx)) as any;
  }

  // Handle arrays
  if (Array.isArray(jsx)) {
    const fragment = document.createDocumentFragment();
    jsx.forEach(child => {
      const element = createDOMElement(child);
      if (element) {
        fragment.appendChild(element);
      }
    });
    return fragment as any;
  }

  // Handle JSX elements
  if (jsx.type) {
    const { type, props = {} } = jsx;

    // Handle function components
    if (typeof type === 'function') {
      const result = type(props);
      return createDOMElement(result);
    }

    // Handle HTML/SVG elements
    const isSVG = type === 'svg' || type === 'path' || type === 'circle' || type === 'rect' ||
                  type === 'line' || type === 'polygon' || type === 'polyline' || type === 'ellipse' ||
                  type === 'g' || type === 'text' || type === 'tspan' || type === 'textPath' ||
                  type === 'defs' || type === 'symbol' || type === 'use' || type === 'linearGradient' ||
                  type === 'radialGradient' || type === 'stop' || type === 'pattern' || type === 'mask' ||
                  type === 'clipPath' || type === 'title' || type === 'desc';

    const element = isSVG
      ? document.createElementNS('http://www.w3.org/2000/svg', type)
      : document.createElement(type);

    // Set attributes
    for (const [key, value] of Object.entries(props)) {
      if (key === 'children') continue;
      if (key === 'className') {
        element.className = String(value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign((element as HTMLElement).style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        const event = key.toLowerCase().substring(2);
        element.addEventListener(event, value as any);
      } else if (key === 'innerHTML') {
        element.innerHTML = String(value);
      } else if (value !== null && value !== undefined && value !== false) {
        // Handle aria and data attributes
        const attrName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        element.setAttribute(attrName, String(value));
      }
    }

    // Add children
    if (props.children) {
      const children = Array.isArray(props.children) ? props.children : [props.children];
      children.forEach((child: any) => {
        const childElement = createDOMElement(child);
        if (childElement) {
          element.appendChild(childElement);
        }
      });
    }

    return element;
  }

  return null;
}

/**
 * Fire an event on an element
 */
export function fireEvent(element: Element, event: Event) {
  element.dispatchEvent(event);
}

/**
 * Wait for element to appear
 */
export async function waitFor(
  callback: () => void | boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const result = callback();
        if (result !== false) {
          resolve();
          return;
        }
      } catch (error) {
        if (Date.now() - startTime > timeout) {
          reject(error);
          return;
        }
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
        return;
      }

      setTimeout(check, interval);
    };

    check();
  });
}