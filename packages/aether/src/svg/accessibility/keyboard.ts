/**
 * Keyboard Navigation for SVG
 *
 * Provides keyboard navigation support for interactive SVG elements
 */

import { signal, effect, onCleanup } from '../../core/reactivity/index.js';
import type { Signal } from '../../core/reactivity/index.js';

/**
 * Focus ring configuration
 */
export interface FocusRingConfig {
  color?: string;
  width?: number;
  offset?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  borderRadius?: number;
}

/**
 * Keyboard navigation configuration
 */
export interface KeyboardNavigationConfig {
  // Navigation
  enableKeyboard?: boolean;
  keys?: {
    next?: string[];
    prev?: string[];
    select?: string[];
    exit?: string[];
  };

  // Focus
  focusable?: boolean;
  autoFocus?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;

  // Visual
  focusRing?: boolean | FocusRingConfig;
}

/**
 * Default keyboard navigation keys
 */
const DEFAULT_KEYS = {
  next: ['ArrowDown', 'ArrowRight', 'Tab'],
  prev: ['ArrowUp', 'ArrowLeft'],
  select: ['Enter', ' '],
  exit: ['Escape'],
};

/**
 * Hook for SVG keyboard navigation
 *
 * Enables keyboard navigation within an SVG element
 */
export function useSVGKeyboardNavigation(
  ref: Signal<SVGElement | null>,
  config: KeyboardNavigationConfig = {}
): {
  focusedElement: Signal<Element | null>;
  focusNext: () => void;
  focusPrev: () => void;
  focusFirst: () => void;
  focusLast: () => void;
} {
  const {
    enableKeyboard = true,
    keys = DEFAULT_KEYS,
    focusable = true,
    autoFocus = false,
    restoreFocus = true,
    trapFocus = false,
    focusRing = true,
  } = config;

  const focusedElement = signal<Element | null>(null);
  const previousFocus = signal<Element | null>(null);
  const focusRingElement = signal<SVGRectElement | null>(null);

  // Merge default keys with custom keys
  const mergedKeys = {
    next: [...DEFAULT_KEYS.next, ...(keys.next || [])],
    prev: [...DEFAULT_KEYS.prev, ...(keys.prev || [])],
    select: [...DEFAULT_KEYS.select, ...(keys.select || [])],
    exit: [...DEFAULT_KEYS.exit, ...(keys.exit || [])],
  };

  /**
   * Get all focusable elements within the SVG
   */
  const getFocusableElements = (): Element[] => {
    const svg = ref();
    if (!svg) return [];

    // Find all focusable elements
    const selector = [
      '[tabindex]:not([tabindex="-1"])',
      '[focusable="true"]',
      'a[href]',
      'button',
      'circle[onclick]',
      'rect[onclick]',
      'path[onclick]',
      'g[onclick]',
    ].join(',');

    const elements = Array.from(svg.querySelectorAll(selector));

    // Also check if the SVG itself is focusable
    if (focusable && svg.hasAttribute('tabindex') && svg.getAttribute('tabindex') !== '-1') {
      elements.unshift(svg);
    }

    return elements;
  };

  /**
   * Focus the next element
   */
  const focusNext = (): void => {
    const elements = getFocusableElements();
    if (elements.length === 0) return;

    const currentIndex = elements.indexOf(focusedElement() as Element);
    const nextIndex = (currentIndex + 1) % elements.length;

    if (trapFocus || nextIndex !== 0) {
      focusElement(elements[nextIndex] as SVGElement);
    }
  };

  /**
   * Focus the previous element
   */
  const focusPrev = (): void => {
    const elements = getFocusableElements();
    if (elements.length === 0) return;

    const currentIndex = elements.indexOf(focusedElement() as Element);
    const prevIndex = currentIndex <= 0 ? elements.length - 1 : currentIndex - 1;

    if (trapFocus || currentIndex > 0) {
      focusElement(elements[prevIndex] as SVGElement);
    }
  };

  /**
   * Focus the first element
   */
  const focusFirst = (): void => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      focusElement(elements[0] as SVGElement);
    }
  };

  /**
   * Focus the last element
   */
  const focusLast = (): void => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      focusElement(elements[elements.length - 1] as SVGElement);
    }
  };

  /**
   * Focus an element and update focus ring
   */
  const focusElement = (element: SVGElement): void => {
    if (!element) return;

    // Set focus
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      element.focus();
    }

    // Update focused element state
    focusedElement.set(element);

    // Update focus ring if enabled
    if (focusRing) {
      updateFocusRing(element);
    }
  };

  /**
   * Update focus ring position and size
   */
  const updateFocusRing = (element: SVGElement): void => {
    const svg = ref();
    if (!svg) return;

    // Get or create focus ring element
    let ring = focusRingElement();
    if (!ring) {
      ring = createFocusRing(svg, focusRing);
      focusRingElement.set(ring);
    }

    // Get element bounding box
    const bbox = (element as any).getBBox();

    // Configure focus ring
    const ringConfig = typeof focusRing === 'object' ? focusRing : {};
    const offset = ringConfig.offset || 2;
    const width = ringConfig.width || 2;

    // Update focus ring attributes
    ring.setAttribute('x', String(bbox.x - offset));
    ring.setAttribute('y', String(bbox.y - offset));
    ring.setAttribute('width', String(bbox.width + offset * 2));
    ring.setAttribute('height', String(bbox.height + offset * 2));
    ring.setAttribute('stroke-width', String(width));

    // Make visible
    ring.style.display = 'block';
  };

  /**
   * Handle keyboard events
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!enableKeyboard) return;

    const key = event.key;

    // Handle navigation keys
    if (mergedKeys.next.includes(key)) {
      event.preventDefault();
      focusNext();
    } else if (mergedKeys.prev.includes(key)) {
      event.preventDefault();
      focusPrev();
    } else if (mergedKeys.select.includes(key)) {
      const element = focusedElement();
      if (element) {
        event.preventDefault();
        // Trigger click event
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    } else if (mergedKeys.exit.includes(key)) {
      event.preventDefault();
      // Exit focus and restore previous focus if needed
      if (restoreFocus) {
        const prev = previousFocus();
        if (prev && prev instanceof HTMLElement) {
          prev.focus();
        }
      }

      // Hide focus ring
      const ring = focusRingElement();
      if (ring) {
        ring.style.display = 'none';
      }

      focusedElement.set(null);
    }
  };

  /**
   * Handle focus events
   */
  const handleFocus = (event: FocusEvent): void => {
    const target = event.target as SVGElement;
    focusedElement.set(target);

    if (focusRing) {
      updateFocusRing(target);
    }
  };

  /**
   * Handle blur events
   */
  const handleBlur = (): void => {
    const ring = focusRingElement();
    if (ring) {
      ring.style.display = 'none';
    }
  };

  // Setup event listeners
  effect(() => {
    const svg = ref();
    if (!svg) return;

    // Make SVG focusable if needed
    if (focusable && !svg.hasAttribute('tabindex')) {
      svg.setAttribute('tabindex', '0');
    }

    // Store previous focus
    if (restoreFocus && document.activeElement) {
      previousFocus.set(document.activeElement);
    }

    // Add event listeners
    svg.addEventListener('keydown', handleKeyDown as EventListener);
    svg.addEventListener('focusin', handleFocus as EventListener);
    svg.addEventListener('focusout', handleBlur as EventListener);

    // Auto focus if requested
    if (autoFocus) {
      focusFirst();
    }

    // Cleanup
    onCleanup(() => {
      svg.removeEventListener('keydown', handleKeyDown as EventListener);
      svg.removeEventListener('focusin', handleFocus as EventListener);
      svg.removeEventListener('focusout', handleBlur as EventListener);

      // Restore focus if needed
      if (restoreFocus) {
        const prev = previousFocus();
        if (prev && prev instanceof HTMLElement) {
          prev.focus();
        }
      }

      // Remove focus ring
      const ring = focusRingElement();
      if (ring && ring.parentNode) {
        ring.parentNode.removeChild(ring);
      }
    });
  });

  return {
    focusedElement,
    focusNext,
    focusPrev,
    focusFirst,
    focusLast,
  };
}

/**
 * Create a focus ring element
 */
function createFocusRing(svg: SVGElement, config: boolean | FocusRingConfig): SVGRectElement {
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

  // Configure appearance
  const settings = typeof config === 'object' ? config : {};
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', settings.color || '#4A90E2');
  ring.setAttribute('stroke-width', String(settings.width || 2));
  ring.setAttribute('stroke-dasharray', settings.style === 'dashed' ? '5,5' : '');
  ring.setAttribute('rx', String(settings.borderRadius || 2));
  ring.setAttribute('ry', String(settings.borderRadius || 2));
  ring.setAttribute('pointer-events', 'none');

  // Initially hidden
  ring.style.display = 'none';

  // Add to SVG (as last child so it's on top)
  svg.appendChild(ring);

  return ring;
}

/**
 * Make an SVG element keyboard focusable
 */
export function makeKeyboardFocusable(element: SVGElement, tabIndex = 0): void {
  element.setAttribute('tabindex', String(tabIndex));
  element.setAttribute('focusable', 'true');
}

/**
 * Remove keyboard focus from an SVG element
 */
export function removeKeyboardFocus(element: SVGElement): void {
  element.removeAttribute('tabindex');
  element.setAttribute('focusable', 'false');
}

/**
 * Check if an element is keyboard focusable
 */
export function isKeyboardFocusable(element: SVGElement): boolean {
  const tabIndex = element.getAttribute('tabindex');
  const focusable = element.getAttribute('focusable');

  return (
    (tabIndex !== null && tabIndex !== '-1') ||
    focusable === 'true' ||
    element.tagName.toLowerCase() === 'a'
  );
}

/**
 * Higher-order component to make an SVG component keyboard accessible
 *
 * Adds keyboard event handlers and focus management
 *
 * @example
 * ```tsx
 * const KeyboardAccessibleIcon = makeKeyboardAccessible(MyIcon, {
 *   onEnter: () => console.log('Enter pressed'),
 *   onSpace: () => console.log('Space pressed')
 * });
 * ```
 */
export function makeKeyboardAccessible<P extends Record<string, any>>(
  Component: (props: P) => any,
  options: {
    onEnter?: (event: KeyboardEvent) => void;
    onSpace?: (event: KeyboardEvent) => void;
    onEscape?: (event: KeyboardEvent) => void;
    onArrowUp?: (event: KeyboardEvent) => void;
    onArrowDown?: (event: KeyboardEvent) => void;
    onArrowLeft?: (event: KeyboardEvent) => void;
    onArrowRight?: (event: KeyboardEvent) => void;
    tabIndex?: number;
    focusRing?: boolean | FocusRingConfig;
  } = {}
): (props: P) => any {
  return (props: P): any => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Enter':
          if (options.onEnter) {
            event.preventDefault();
            options.onEnter(event);
          }
          break;
        case ' ':
        case 'Space':
          if (options.onSpace) {
            event.preventDefault();
            options.onSpace(event);
          }
          break;
        case 'Escape':
          if (options.onEscape) {
            event.preventDefault();
            options.onEscape(event);
          }
          break;
        case 'ArrowUp':
          if (options.onArrowUp) {
            event.preventDefault();
            options.onArrowUp(event);
          }
          break;
        case 'ArrowDown':
          if (options.onArrowDown) {
            event.preventDefault();
            options.onArrowDown(event);
          }
          break;
        case 'ArrowLeft':
          if (options.onArrowLeft) {
            event.preventDefault();
            options.onArrowLeft(event);
          }
          break;
        case 'ArrowRight':
          if (options.onArrowRight) {
            event.preventDefault();
            options.onArrowRight(event);
          }
          break;
        default:
          // No action needed for other keys
          break;
      }
    };

    const mergedProps = {
      ...props,
      onKeyDown: (event: KeyboardEvent) => {
        handleKeyDown(event);
        if ((props as any).onKeyDown) {
          (props as any).onKeyDown(event);
        }
      },
      tabIndex: options.tabIndex ?? 0,
      focusable: 'true',
    };

    return Component(mergedProps);
  };
}
