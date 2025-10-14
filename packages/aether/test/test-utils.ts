/**
 * Test utilities for Aether framework
 */

import { Component, JSX } from '../src/index';
import { renderVNodeWithBindings } from '../src/reconciler/jsx-integration';
import type { VNode } from '../src/reconciler/vnode';

/**
 * Helper to check if a value is a VNode
 */
function isVNode(value: any): value is VNode {
  return value && typeof value === 'object' && 'type' in value && 'props' in value;
}

/**
 * Render a component for testing
 */
export function render(component: Component | (() => JSX.Element)) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  // Execute component function and append to container
  const result = typeof component === 'function' ? component() : component;

  // Handle different result types
  if (typeof result === 'string') {
    container.innerHTML = result;
  } else if (isVNode(result)) {
    // VNode - render with reactive bindings
    const dom = renderVNodeWithBindings(result);
    container.appendChild(dom);
  } else if (result instanceof Node) {
    // Already a DOM node - just append it
    container.appendChild(result);
  } else if (result && typeof result === 'object') {
    // Handle JSX element object (legacy path)
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
      } else if (isVNode(newResult)) {
        // VNode - render with reactive bindings
        const dom = renderVNodeWithBindings(newResult);
        container.appendChild(dom);
      } else if (newResult instanceof Node) {
        // Already a DOM node - just append it
        container.appendChild(newResult);
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
      // Component might be wrapped by defineComponent
      // Try calling it and see if it returns a function (render function) or JSX
      const result = type(props);

      // If result is a function, it's the render function from defineComponent - call it
      if (typeof result === 'function') {
        const jsx = result();
        return createDOMElement(jsx);
      }

      // Otherwise it's already JSX, process it
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

      // Resolve signal values
      let resolvedValue = value;
      if (typeof value === 'function' && value.peek !== undefined) {
        // It's a signal
        resolvedValue = value();
      }

      if (key === 'className') {
        element.className = String(resolvedValue);
      } else if (key === 'style' && typeof resolvedValue === 'object') {
        Object.assign((element as HTMLElement).style, resolvedValue);
      } else if (key.startsWith('on') && typeof resolvedValue === 'function') {
        const event = key.toLowerCase().substring(2);
        element.addEventListener(event, resolvedValue as any);
      } else if (key === 'innerHTML') {
        element.innerHTML = String(resolvedValue);
      } else if (resolvedValue !== null && resolvedValue !== undefined && resolvedValue !== false) {
        // Handle aria and data attributes
        const attrName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        element.setAttribute(attrName, String(resolvedValue));
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

/**
 * Animation testing utilities
 */

/**
 * Wait for animation to complete with fake timers
 * Advances timers by the specified duration and allows for animation frame callbacks
 *
 * @param duration - Duration in milliseconds to wait
 * @param vi - Vitest instance (import { vi } from 'vitest')
 */
export async function waitForAnimation(duration: number, vi?: any): Promise<void> {
  if (vi && vi.advanceTimersByTimeAsync) {
    // Use fake timers if available
    await vi.advanceTimersByTimeAsync(duration);
  } else {
    // Fallback to real timers
    await new Promise(resolve => setTimeout(resolve, duration));
  }
}

/**
 * Flush all pending microtasks
 * Useful when you need to ensure all promise callbacks have executed
 */
export async function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

/**
 * Run all animation frames
 * Advances timers and processes all pending animation frames
 *
 * @param vi - Vitest instance (import { vi } from 'vitest')
 * @param maxFrames - Maximum number of frames to process (default: 60 = 1 second at 60fps)
 */
export async function runAnimationFrames(vi: any, maxFrames: number = 60): Promise<void> {
  const frameTime = 1000 / 60; // ~16.67ms per frame at 60fps

  for (let i = 0; i < maxFrames; i++) {
    await vi.advanceTimersByTimeAsync(frameTime);
  }
}

/**
 * Advance timers with proper animation frame handling
 * Combines timer advancement with animation frame processing
 *
 * @param duration - Duration in milliseconds
 * @param vi - Vitest instance (import { vi } from 'vitest')
 */
export async function advanceTimersWithAnimation(duration: number, vi: any): Promise<void> {
  // Advance in small chunks to process animation frames
  const chunkSize = 16.67; // One animation frame
  const chunks = Math.ceil(duration / chunkSize);

  for (let i = 0; i < chunks; i++) {
    await vi.advanceTimersByTimeAsync(Math.min(chunkSize, duration - (i * chunkSize)));
  }
}