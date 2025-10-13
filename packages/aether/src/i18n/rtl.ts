/**
 * RTL/LTR Support
 *
 * Right-to-left and left-to-right language support
 */

import type { LocaleCode } from './types.js';

/**
 * RTL languages list
 * Languages that are written from right to left
 */
const RTL_LANGUAGES = new Set([
  'ar', // Arabic
  'arc', // Aramaic
  'dv', // Divehi
  'fa', // Persian
  'ha', // Hausa
  'he', // Hebrew
  'khw', // Khowar
  'ks', // Kashmiri
  'ku', // Kurdish
  'ps', // Pashto
  'ur', // Urdu
  'yi', // Yiddish
]);

/**
 * Check if a locale uses RTL direction
 */
export function isRTL(locale: LocaleCode): boolean {
  // Extract language code (first part before '-' or '_')
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language ? RTL_LANGUAGES.has(language) : false;
}

/**
 * Get text direction for locale
 */
export function getDirection(locale: LocaleCode): 'ltr' | 'rtl' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

/**
 * Apply direction to element
 */
export function applyDirection(element: HTMLElement, locale: LocaleCode): void {
  const direction = getDirection(locale);
  element.dir = direction;
  element.lang = locale;
}

/**
 * Create direction class name
 */
export function getDirectionClassName(locale: LocaleCode, prefix = 'dir'): string {
  const direction = getDirection(locale);
  return `${prefix}-${direction}`;
}

/**
 * Get start position (left for LTR, right for RTL)
 */
export function getStartPosition(locale: LocaleCode): 'left' | 'right' {
  return isRTL(locale) ? 'right' : 'left';
}

/**
 * Get end position (right for LTR, left for RTL)
 */
export function getEndPosition(locale: LocaleCode): 'left' | 'right' {
  return isRTL(locale) ? 'left' : 'right';
}

/**
 * Flip value for RTL (e.g., flip margins/padding)
 */
export function flipForRTL<T>(locale: LocaleCode, ltrValue: T, rtlValue: T): T {
  return isRTL(locale) ? rtlValue : ltrValue;
}

/**
 * Get logical property value
 * Converts physical properties (left/right) to logical properties (start/end)
 */
export function getLogicalProperty(property: string, value: any, locale: LocaleCode): { property: string; value: any } {
  const direction = getDirection(locale);

  // Map physical properties to logical equivalents
  const logicalMap: Record<string, string> = {
    'margin-left': 'margin-inline-start',
    'margin-right': 'margin-inline-end',
    'padding-left': 'padding-inline-start',
    'padding-right': 'padding-inline-end',
    left: 'inset-inline-start',
    right: 'inset-inline-end',
    'border-left': 'border-inline-start',
    'border-right': 'border-inline-end',
    'border-left-width': 'border-inline-start-width',
    'border-right-width': 'border-inline-end-width',
    'border-left-color': 'border-inline-start-color',
    'border-right-color': 'border-inline-end-color',
    'border-left-style': 'border-inline-start-style',
    'border-right-style': 'border-inline-end-style',
    'text-align': 'text-align',
  };

  // Handle text-align specially
  if (property === 'text-align') {
    if (value === 'left') {
      return { property, value: direction === 'rtl' ? 'right' : 'left' };
    } else if (value === 'right') {
      return { property, value: direction === 'rtl' ? 'left' : 'right' };
    }
  }

  // Use logical property if available
  if (logicalMap[property]) {
    return { property: logicalMap[property], value };
  }

  return { property, value };
}

/**
 * Create RTL-aware styles object
 */
export function createDirectionStyles(locale: LocaleCode, styles: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [property, value] of Object.entries(styles)) {
    const { property: newProperty, value: newValue } = getLogicalProperty(property, value, locale);
    result[newProperty] = newValue;
  }

  return result;
}

/**
 * Direction observer
 * Observes direction changes and updates elements
 */
export class DirectionObserver {
  private observers: Set<(direction: 'ltr' | 'rtl') => void> = new Set();
  private currentDirection: 'ltr' | 'rtl' = 'ltr';

  constructor(initialLocale: LocaleCode) {
    this.currentDirection = getDirection(initialLocale);
  }

  /**
   * Subscribe to direction changes
   */
  subscribe(callback: (direction: 'ltr' | 'rtl') => void): () => void {
    this.observers.add(callback);

    // Unsubscribe function
    return () => {
      this.observers.delete(callback);
    };
  }

  /**
   * Update direction based on locale
   */
  updateDirection(locale: LocaleCode): void {
    const newDirection = getDirection(locale);

    if (newDirection !== this.currentDirection) {
      this.currentDirection = newDirection;
      this.notify();
    }
  }

  /**
   * Get current direction
   */
  getDirection(): 'ltr' | 'rtl' {
    return this.currentDirection;
  }

  /**
   * Notify observers
   */
  private notify(): void {
    for (const observer of this.observers) {
      observer(this.currentDirection);
    }
  }
}
