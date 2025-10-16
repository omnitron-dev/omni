/**
 * Screen Reader Support for SVG
 *
 * Provides hooks and utilities for screen reader announcements
 * and live region management
 */

import { signal, effect, onCleanup } from '../../core/reactivity/index.js';

/**
 * Screen reader configuration
 */
export interface ScreenReaderConfig {
  // Text alternatives
  announceOnHover?: boolean;
  announceOnFocus?: boolean;

  // Live regions
  liveUpdates?: boolean;
  updateDebounce?: number;

  // Descriptions
  verboseDescriptions?: boolean;
  includeDataValues?: boolean;
}

/**
 * Hook for screen reader announcements
 *
 * Creates a live region for announcing messages to screen readers
 */
export function useScreenReaderAnnounce(): {
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
  clear: () => void;
} {
  const liveRegion = signal<HTMLElement | null>(null);
  const announceTimeout = signal<number | null>(null);

  // Create live region on mount
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    effect(() => {
      const region = createLiveRegion();
      liveRegion.set(region);

      // Cleanup on unmount
      onCleanup(() => {
        if (region && region.parentNode) {
          region.parentNode.removeChild(region);
        }
      });
    });
  }

  /**
   * Announce a message to screen readers
   */
  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite'): void => {
    const region = liveRegion();
    if (!region) return;

    // Clear any pending announcement
    const timeout = announceTimeout();
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    // Update priority
    region.setAttribute('aria-live', priority);

    // Clear existing message first (important for repeated messages)
    region.textContent = '';

    // Announce new message after a brief delay
    const newTimeout = window.setTimeout(() => {
      region.textContent = message;
    }, 100);

    announceTimeout.set(newTimeout);
  };

  /**
   * Clear the live region
   */
  const clear = (): void => {
    const region = liveRegion();
    if (region) {
      region.textContent = '';
    }

    const timeout = announceTimeout();
    if (timeout !== null) {
      clearTimeout(timeout);
      announceTimeout.set(null);
    }
  };

  return { announce, clear };
}

/**
 * Create a live region element for screen reader announcements
 */
function createLiveRegion(): HTMLElement {
  const region = document.createElement('div');

  // Set ARIA attributes
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');

  // Hide visually but keep accessible to screen readers
  region.style.position = 'absolute';
  region.style.left = '-10000px';
  region.style.width = '1px';
  region.style.height = '1px';
  region.style.overflow = 'hidden';
  region.className = 'aether-sr-only';

  // Append to body
  document.body.appendChild(region);

  return region;
}

/**
 * Debounced screen reader announcer
 */
export class DebouncedAnnouncer {
  private timeout: number | null = null;
  private readonly debounceMs: number;
  private readonly priority: 'polite' | 'assertive';

  constructor(debounceMs = 300, priority: 'polite' | 'assertive' = 'polite') {
    this.debounceMs = debounceMs;
    this.priority = priority;
  }

  /**
   * Announce with debouncing
   */
  announce(message: string, announceFn: (msg: string, priority: 'polite' | 'assertive') => void): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
    }

    this.timeout = window.setTimeout(() => {
      announceFn(message, this.priority);
      this.timeout = null;
    }, this.debounceMs);
  }

  /**
   * Clear pending announcement
   */
  clear(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}

/**
 * Hook for verbose SVG descriptions
 *
 * Generates detailed descriptions for screen readers including data values
 */
export function useVerboseDescription(
  config: {
    includeDataValues?: boolean;
    updateOnChange?: boolean;
  } = {}
): {
  describe: (element: SVGElement) => string;
  announceDescription: (element: SVGElement, priority?: 'polite' | 'assertive') => void;
} {
  const { announce } = useScreenReaderAnnounce();

  /**
   * Generate verbose description for an SVG element
   */
  const describe = (element: SVGElement): string => {
    const parts: string[] = [];

    // Get element type
    const tagName = element.tagName.toLowerCase();
    parts.push(getReadableName(tagName));

    // Get accessible name
    const accessibleName = getAccessibleName(element);
    if (accessibleName) {
      parts.push(accessibleName);
    }

    // Get data values if requested
    if (config.includeDataValues) {
      const dataValues = extractDataValues(element);
      if (dataValues.length > 0) {
        parts.push(`with values: ${dataValues.join(', ')}`);
      }
    }

    return parts.join(' ');
  };

  /**
   * Announce description to screen readers
   */
  const announceDescription = (element: SVGElement, priority: 'polite' | 'assertive' = 'polite'): void => {
    const description = describe(element);
    announce(description, priority);
  };

  return { describe, announceDescription };
}

/**
 * Get accessible name from an element
 */
function getAccessibleName(element: SVGElement): string {
  // Check aria-labelledby (highest priority per ARIA spec)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement) {
      return labelElement.textContent || '';
    }
  }

  // Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Check title element
  const titleElement = element.querySelector('title');
  if (titleElement) {
    return titleElement.textContent || '';
  }

  return '';
}

/**
 * Extract data values from SVG element
 */
function extractDataValues(element: SVGElement): string[] {
  const values: string[] = [];

  // Extract common data attributes
  const dataAttrs = ['data-value', 'data-label', 'data-name'];
  for (const attr of dataAttrs) {
    const value = element.getAttribute(attr);
    if (value) {
      values.push(value);
    }
  }

  // Extract text content
  const textElements = element.querySelectorAll('text, tspan');
  textElements.forEach((el) => {
    const text = el.textContent?.trim();
    if (text) {
      values.push(text);
    }
  });

  return values;
}

/**
 * Get readable name for SVG element type
 */
function getReadableName(tagName: string): string {
  const names: Record<string, string> = {
    circle: 'circle',
    rect: 'rectangle',
    path: 'path',
    line: 'line',
    polygon: 'polygon',
    polyline: 'polyline',
    ellipse: 'ellipse',
    text: 'text',
    image: 'image',
    g: 'group',
    svg: 'graphic',
  };

  return names[tagName] || tagName;
}

/**
 * Create a screen reader only text element
 */
export function createSROnlyText(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'aether-sr-only';
  span.textContent = text;

  // Hide visually but keep accessible
  span.style.position = 'absolute';
  span.style.left = '-10000px';
  span.style.width = '1px';
  span.style.height = '1px';
  span.style.overflow = 'hidden';

  return span;
}

/**
 * Announce a message to screen readers
 *
 * Utility function that creates a temporary live region for announcements
 *
 * @param message - Message to announce
 * @param priority - Priority level ('polite' or 'assertive')
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // Find or create live region
  let region = document.getElementById('aether-sr-announcer');
  if (!region) {
    region = createLiveRegion();
    region.id = 'aether-sr-announcer';
  }

  // Update priority
  region.setAttribute('aria-live', priority);

  // Clear existing message first
  region.textContent = '';

  // Announce new message after a brief delay
  setTimeout(() => {
    region!.textContent = message;
  }, 100);
}

/**
 * Generate description for complex SVG
 *
 * Analyzes SVG structure and generates a meaningful description
 */
export function generateComplexSVGDescription(svg: SVGElement): string {
  const parts: string[] = [];

  // Count element types
  const circles = svg.querySelectorAll('circle').length;
  const rects = svg.querySelectorAll('rect').length;
  const paths = svg.querySelectorAll('path').length;
  const lines = svg.querySelectorAll('line').length;
  const polygons = svg.querySelectorAll('polygon').length;
  const texts = svg.querySelectorAll('text').length;

  // Build description
  if (circles > 0) parts.push(`${circles} circle${circles > 1 ? 's' : ''}`);
  if (rects > 0) parts.push(`${rects} rectangle${rects > 1 ? 's' : ''}`);
  if (paths > 0) parts.push(`${paths} path${paths > 1 ? 's' : ''}`);
  if (lines > 0) parts.push(`${lines} line${lines > 1 ? 's' : ''}`);
  if (polygons > 0) parts.push(`${polygons} polygon${polygons > 1 ? 's' : ''}`);
  if (texts > 0) parts.push(`${texts} text element${texts > 1 ? 's' : ''}`);

  if (parts.length === 0) {
    return 'Complex SVG graphic';
  }

  return `Graphic containing ${parts.join(', ')}`;
}

/**
 * Helper to hide decorative content from screen readers
 */
export function hideFromScreenReaders(element: SVGElement): void {
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('role', 'presentation');
}

/**
 * Helper to show content to screen readers
 */
export function showToScreenReaders(element: SVGElement): void {
  element.removeAttribute('aria-hidden');
  if (element.getAttribute('role') === 'presentation') {
    element.removeAttribute('role');
  }
}
