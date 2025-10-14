/**
 * Client-Side Hydration for SSR SVG Components
 *
 * Hydrate server-rendered SVG components with client-side reactivity
 */

import type { Component } from '../../core/component/types.js';
import { canUseDOM, parseStyles } from './utils.js';

export type HydrationStrategy = 'immediate' | 'idle' | 'visible' | 'interaction';

export interface HydrationConfig {
  /** Hydration strategy (default: 'immediate') */
  strategy?: HydrationStrategy;

  /** Preserve server-rendered attributes (default: true) */
  preserveAttributes?: boolean;

  /** Preserve event listeners (default: true) */
  preserveEvents?: boolean;

  /** Preserve animations (default: true) */
  preserveAnimations?: boolean;

  /** Validate structure matches expected (default: true) */
  validateStructure?: boolean;

  /** Callback when hydration mismatch detected */
  onMismatch?: (error: HydrationError) => void;

  /** Intersection observer options for 'visible' strategy */
  intersectionOptions?: IntersectionObserverInit;

  /** Interaction events to listen for with 'interaction' strategy */
  interactionEvents?: string[];

  /** Timeout for idle strategy (ms, default: 2000) */
  idleTimeout?: number;
}

export interface HydrationError {
  type: 'structure' | 'attribute' | 'children';
  message: string;
  element: Element;
  expected?: any;
  actual?: any;
}

export interface HydrationResult {
  success: boolean;
  errors: HydrationError[];
  element: SVGElement;
}

/**
 * Hydrate a server-rendered SVG element with client-side component
 */
export function hydrateSVG(
  element: SVGElement | Element,
  component: Component<any>,
  props: any = {},
  config: HydrationConfig = {}
): Promise<HydrationResult> {
  const {
    strategy = 'immediate',
    preserveAttributes: shouldPreserveAttributes = true,
    preserveEvents = true,
    preserveAnimations: shouldPreserveAnimations = true,
    validateStructure: shouldValidateStructure = true,
    onMismatch,
  } = config;

  // Check if we can hydrate
  if (!canUseDOM()) {
    return Promise.reject(new Error('Cannot hydrate on server'));
  }

  // Create hydration promise based on strategy
  return new Promise((resolve, reject) => {
    const performHydration = () => {
      try {
        const result = hydrateElement(
          element,
          component,
          props,
          {
            preserveAttributes: shouldPreserveAttributes,
            preserveEvents,
            preserveAnimations: shouldPreserveAnimations,
            validateStructure: shouldValidateStructure,
            onMismatch,
          }
        );
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    switch (strategy) {
      case 'immediate':
        performHydration();
        break;

      case 'idle':
        scheduleIdleHydration(performHydration, config.idleTimeout);
        break;

      case 'visible':
        scheduleVisibleHydration(element as Element, performHydration, config.intersectionOptions);
        break;

      case 'interaction':
        scheduleInteractionHydration(
          element as Element,
          performHydration,
          config.interactionEvents
        );
        break;

      default:
        // For unknown strategies, fall back to immediate hydration
        performHydration();
        break;
    }
  });
}

/**
 * Perform actual hydration of element
 */
function hydrateElement(
  element: SVGElement | Element,
  component: Component<any>,
  props: any,
  config: {
    preserveAttributes: boolean;
    preserveEvents: boolean;
    preserveAnimations: boolean;
    validateStructure: boolean;
    onMismatch?: (error: HydrationError) => void;
  }
): HydrationResult {
  const errors: HydrationError[] = [];

  // Get server-rendered state
  const serverState = captureElementState(element);

  // Execute component to get expected result
  const renderFn = component(props);
  const clientResult = typeof renderFn === 'function' ? renderFn() : renderFn;

  // Validate structure if requested
  if (config.validateStructure) {
    const structureErrors = validateStructure(element, clientResult);
    errors.push(...structureErrors);

    // Call mismatch handler for each error
    if (config.onMismatch) {
      structureErrors.forEach(error => config.onMismatch!(error));
    }
  }

  // Preserve server state if requested
  if (config.preserveAttributes) {
    preserveAttributes(element, serverState.attributes);
  }

  if (config.preserveAnimations) {
    preserveAnimations(element, serverState.animations);
  }

  // Attach component instance to element
  (element as any).__aether_component = component;
  (element as any).__aether_props = props;

  // Mark as hydrated
  element.setAttribute('data-aether-hydrated', 'true');

  return {
    success: errors.length === 0,
    errors,
    element: element as SVGElement,
  };
}

/**
 * Capture current state of element
 */
function captureElementState(element: Element): {
  attributes: Record<string, string>;
  styles: Record<string, string>;
  animations: Animation[];
} {
  const attributes: Record<string, string> = {};
  const styles: Record<string, string> = {};

  // Capture attributes
  Array.from(element.attributes).forEach(attr => {
    attributes[attr.name] = attr.value;
  });

  // Capture styles
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    const _computedStyle = window.getComputedStyle(element);
    const styleAttr = element.getAttribute('style');
    if (styleAttr) {
      Object.assign(styles, parseStyles(styleAttr));
    }
  }

  // Capture animations
  const animations = element instanceof Element ? element.getAnimations() : [];

  return { attributes, styles, animations };
}

/**
 * Validate element structure matches expected
 */
function validateStructure(element: Element, expected: any): HydrationError[] {
  const errors: HydrationError[] = [];

  // Check tag name
  if (expected?.type && typeof expected.type === 'string') {
    if (element.tagName.toLowerCase() !== expected.type.toLowerCase()) {
      errors.push({
        type: 'structure',
        message: `Tag mismatch: expected ${expected.type}, got ${element.tagName}`,
        element,
        expected: expected.type,
        actual: element.tagName,
      });
    }
  }

  // Check children count (basic validation)
  if (expected?.props?.children) {
    const expectedChildCount = Array.isArray(expected.props.children)
      ? expected.props.children.length
      : 1;
    const actualChildCount = element.children.length;

    if (actualChildCount !== expectedChildCount) {
      errors.push({
        type: 'children',
        message: `Children count mismatch: expected ${expectedChildCount}, got ${actualChildCount}`,
        element,
        expected: expectedChildCount,
        actual: actualChildCount,
      });
    }
  }

  return errors;
}

/**
 * Preserve attributes on element
 */
function preserveAttributes(element: Element, attributes: Record<string, string>): void {
  Object.entries(attributes).forEach(([name, value]) => {
    if (!element.hasAttribute(name)) {
      element.setAttribute(name, value);
    }
  });
}

/**
 * Preserve animations on element
 */
function preserveAnimations(element: Element, animations: Animation[]): void {
  animations.forEach(animation => {
    // Restart animation if it was playing
    if (animation.playState === 'running') {
      animation.play();
    }
  });
}

/**
 * Schedule hydration during browser idle time
 */
function scheduleIdleHydration(callback: () => void, timeout: number = 2000): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, 0);
  }
}

/**
 * Schedule hydration when element becomes visible
 */
function scheduleVisibleHydration(
  element: Element,
  callback: () => void,
  options?: IntersectionObserverInit
): void {
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          callback();
          observer.disconnect();
        }
      });
    },
    options || { threshold: 0.01 }
  );

  observer.observe(element);
}

/**
 * Schedule hydration on user interaction
 */
function scheduleInteractionHydration(
  element: Element,
  callback: () => void,
  events: string[] = ['mouseenter', 'focusin', 'touchstart']
): void {
  let executed = false;

  const handler = () => {
    if (!executed) {
      executed = true;
      callback();
      // Remove listeners
      events.forEach(event => element.removeEventListener(event, handler));
    }
  };

  // Add listeners
  events.forEach(event => element.addEventListener(event, handler, { once: true, passive: true }));
}

/**
 * Hydrate all SVG elements with hydration markers
 */
export function hydrateAll(
  root: Document | Element = document,
  components: Record<string, Component<any>>,
  config: HydrationConfig = {}
): Promise<HydrationResult[]> {
  const elements = root.querySelectorAll('[data-aether-hydrate]');
  const promises: Promise<HydrationResult>[] = [];

  elements.forEach(element => {
    const componentName = element.getAttribute('data-aether-hydrate');
    const propsJson = element.getAttribute('data-aether-props');

    if (componentName && components[componentName]) {
      const props = propsJson ? JSON.parse(propsJson) : {};
      const promise = hydrateSVG(element as SVGElement, components[componentName], props, config);
      promises.push(promise);
    }
  });

  return Promise.all(promises);
}

/**
 * Check if an element has been hydrated
 */
export function isHydrated(element: Element): boolean {
  return element.hasAttribute('data-aether-hydrated');
}

/**
 * Get hydration data from element
 */
export function getHydrationData(element: Element): {
  component?: Component<any>;
  props?: any;
} | null {
  const component = (element as any).__aether_component;
  const props = (element as any).__aether_props;

  return component ? { component, props } : null;
}

/**
 * Dehydrate element (remove client-side data)
 */
export function dehydrate(element: Element): void {
  delete (element as any).__aether_component;
  delete (element as any).__aether_props;
  element.removeAttribute('data-aether-hydrated');
}
