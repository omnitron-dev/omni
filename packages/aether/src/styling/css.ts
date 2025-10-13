/**
 * CSS Utilities
 *
 * Utilities for CSS generation and manipulation:
 * - css() - Template function for generating styles
 * - cx() - Class name merger
 * - keyframes() - Animation keyframes
 * - globalStyles() - Global style injection
 */

import { injectStyles, getGlobalSheet } from './runtime.js';

/**
 * CSS property value
 */
export type CSSValue = string | number | undefined | null;

/**
 * CSS properties object
 */
export type CSSProperties = Record<string, CSSValue>;

/**
 * Class name value
 */
export type ClassValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | ClassValue[]
  | Record<string, boolean | undefined | null>;

/**
 * Keyframe definition
 */
export interface Keyframe {
  [key: string]: CSSProperties;
}

/**
 * Generate a CSS class from style object
 *
 * @param styles - CSS properties
 * @returns Class name
 *
 * @example
 * ```typescript
 * const className = css({
 *   color: 'red',
 *   fontSize: 16,
 *   '&:hover': {
 *     color: 'blue'
 *   }
 * });
 * ```
 */
export function css(styles: CSSProperties | CSSProperties[]): string {
  if (Array.isArray(styles)) {
    return cx(...styles.map((s) => css(s)));
  }

  // Extract pseudo-selectors and media queries
  const baseStyles: CSSProperties = {};
  const pseudoSelectors: Record<string, CSSProperties> = {};
  let mediaQuery: string | undefined;

  for (const [key, value] of Object.entries(styles)) {
    if (value === undefined || value === null) continue;

    if (key.startsWith('&:') || key.startsWith('&::')) {
      // Pseudo-selector
      const pseudo = key.slice(1); // Remove &
      pseudoSelectors[pseudo] = value as unknown as CSSProperties;
    } else if (key.startsWith('@media')) {
      // Media query - we'll handle this separately
      mediaQuery = key.replace('@media ', '');
      Object.assign(baseStyles, value as unknown as CSSProperties);
    } else {
      baseStyles[key] = value;
    }
  }

  // Filter out undefined/null values before passing to injectStyles
  const filteredBaseStyles: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(baseStyles)) {
    if (value !== undefined && value !== null) {
      filteredBaseStyles[key] = value as string | number;
    }
  }

  const filteredPseudoSelectors: Record<string, Record<string, string | number>> = {};
  for (const [key, props] of Object.entries(pseudoSelectors)) {
    const filtered: Record<string, string | number> = {};
    for (const [propKey, propValue] of Object.entries(props)) {
      if (propValue !== undefined && propValue !== null) {
        filtered[propKey] = propValue as string | number;
      }
    }
    filteredPseudoSelectors[key] = filtered;
  }

  return injectStyles(filteredBaseStyles, {
    pseudoSelectors: Object.keys(filteredPseudoSelectors).length > 0 ? filteredPseudoSelectors : undefined,
    media: mediaQuery,
  });
}

/**
 * Merge class names intelligently
 *
 * Handles strings, arrays, objects, and conditional classes
 *
 * @param classes - Class values to merge
 * @returns Merged class string
 *
 * @example
 * ```typescript
 * cx('foo', 'bar'); // 'foo bar'
 * cx('foo', null, 'bar'); // 'foo bar'
 * cx({ foo: true, bar: false }); // 'foo'
 * cx(['foo', 'bar']); // 'foo bar'
 * ```
 */
export function cx(...classes: ClassValue[]): string {
  const result: string[] = [];

  for (const cls of classes) {
    if (!cls) continue;

    if (typeof cls === 'string') {
      result.push(cls);
    } else if (typeof cls === 'number') {
      result.push(String(cls));
    } else if (Array.isArray(cls)) {
      const nested = cx(...cls);
      if (nested) result.push(nested);
    } else if (typeof cls === 'object') {
      for (const [key, value] of Object.entries(cls)) {
        if (value) result.push(key);
      }
    }
  }

  return result.join(' ');
}

/**
 * Generate CSS keyframes for animations
 *
 * @param name - Animation name
 * @param frames - Keyframe definitions
 * @returns Animation name
 *
 * @example
 * ```typescript
 * const fadeIn = keyframes('fadeIn', {
 *   '0%': { opacity: 0 },
 *   '100%': { opacity: 1 }
 * });
 *
 * const className = css({
 *   animation: `${fadeIn} 1s ease-in-out`
 * });
 * ```
 */
export function keyframes(name: string, frames: Keyframe): string {
  const sheet = getGlobalSheet();

  // Build keyframes CSS
  const keyframeRules: string[] = [];

  for (const [key, properties] of Object.entries(frames)) {
    const props = Object.entries(properties)
      .map(([prop, value]) => {
        const cssProp = prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        return `    ${cssProp}: ${value};`;
      })
      .join('\n');

    keyframeRules.push(`  ${key} {\n${props}\n  }`);
  }

  const keyframeCSS = `@keyframes ${name} {\n${keyframeRules.join('\n')}\n}`;

  // Inject into stylesheet
  if (sheet.element) {
    try {
      sheet.element.sheet?.insertRule(keyframeCSS, sheet.element.sheet.cssRules.length);
    } catch (e) {
      console.warn('Failed to insert keyframe:', keyframeCSS, e);
    }
  }

  return name;
}

/**
 * Inject global styles
 *
 * @param styles - Global CSS styles
 *
 * @example
 * ```typescript
 * globalStyles({
 *   'body': {
 *     margin: 0,
 *     padding: 0,
 *     fontFamily: 'sans-serif'
 *   },
 *   '*': {
 *     boxSizing: 'border-box'
 *   }
 * });
 * ```
 */
export function globalStyles(styles: Record<string, CSSProperties>): void {
  const sheet = getGlobalSheet();

  for (const [selector, properties] of Object.entries(styles)) {
    const props = Object.entries(properties)
      .map(([prop, value]) => {
        if (value === undefined || value === null) return '';
        const cssProp = prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        return `  ${cssProp}: ${value};`;
      })
      .filter(Boolean)
      .join('\n');

    const css = `${selector} {\n${props}\n}`;

    if (sheet.element?.sheet) {
      try {
        sheet.element.sheet.insertRule(css, sheet.element.sheet.cssRules.length);
      } catch (e) {
        console.warn('Failed to insert global style:', css, e);
      }
    }
  }
}

/**
 * Create a CSS reset
 *
 * @example
 * ```typescript
 * cssReset(); // Apply basic CSS reset
 * ```
 */
export function cssReset(): void {
  globalStyles({
    '*': {
      boxSizing: 'border-box',
      margin: 0,
      padding: 0,
    },
    'html, body': {
      height: '100%',
      width: '100%',
    },
    body: {
      lineHeight: 1.5,
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    },
    'img, picture, video, canvas, svg': {
      display: 'block',
      maxWidth: '100%',
    },
    'input, button, textarea, select': {
      font: 'inherit',
    },
    'p, h1, h2, h3, h4, h5, h6': {
      overflowWrap: 'break-word',
    },
  });
}

/**
 * Create responsive CSS with breakpoints
 *
 * @param styles - Styles with breakpoint keys
 * @returns Class name
 *
 * @example
 * ```typescript
 * const className = responsive({
 *   base: { fontSize: 14 },
 *   sm: { fontSize: 16 },
 *   md: { fontSize: 18 },
 *   lg: { fontSize: 20 }
 * });
 * ```
 */
export function responsive(styles: {
  base?: CSSProperties;
  sm?: CSSProperties;
  md?: CSSProperties;
  lg?: CSSProperties;
  xl?: CSSProperties;
}): string {
  const breakpoints = {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  };

  const classNames: string[] = [];

  // Base styles
  if (styles.base) {
    classNames.push(css(styles.base));
  }

  // Responsive styles
  for (const [key, value] of Object.entries(styles)) {
    if (key === 'base' || !value) continue;

    const mediaQuery = `(min-width: ${breakpoints[key as keyof typeof breakpoints]})`;
    const filtered: Record<string, string | number> = {};
    for (const [propKey, propValue] of Object.entries(value)) {
      if (propValue !== undefined && propValue !== null) {
        filtered[propKey] = propValue as string | number;
      }
    }
    classNames.push(injectStyles(filtered, { media: mediaQuery }));
  }

  return cx(...classNames);
}

/**
 * Create dark mode styles
 *
 * @param lightStyles - Styles for light mode
 * @param darkStyles - Styles for dark mode
 * @returns Class name
 *
 * @example
 * ```typescript
 * const className = darkMode(
 *   { color: 'black', backgroundColor: 'white' },
 *   { color: 'white', backgroundColor: 'black' }
 * );
 * ```
 */
export function darkMode(lightStyles: CSSProperties, darkStyles: CSSProperties): string {
  const lightClass = css(lightStyles);
  const filtered: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(darkStyles)) {
    if (value !== undefined && value !== null) {
      filtered[key] = value as string | number;
    }
  }
  const darkClass = injectStyles(filtered, {
    media: '(prefers-color-scheme: dark)',
  });

  return cx(lightClass, darkClass);
}

/**
 * Merge CSS properties deeply
 *
 * @param cssObjects - CSS property objects to merge
 * @returns Merged CSS properties
 *
 * @example
 * ```typescript
 * const merged = mergeCSS(
 *   { color: 'red', fontSize: 16 },
 *   { color: 'blue', fontWeight: 'bold' }
 * );
 * // Result: { color: 'blue', fontSize: 16, fontWeight: 'bold' }
 * ```
 */
export function mergeCSS(...cssObjects: (CSSProperties | undefined | null)[]): CSSProperties {
  const result: CSSProperties = {};

  for (const css of cssObjects) {
    if (!css) continue;
    Object.assign(result, css);
  }

  return result;
}

/**
 * Create CSS variables object
 *
 * @param vars - Variable definitions
 * @returns CSS properties with CSS variables
 *
 * @example
 * ```typescript
 * const vars = cssVariables({
 *   'primary-color': '#007bff',
 *   'secondary-color': '#6c757d',
 *   'spacing': '1rem'
 * });
 *
 * const className = css(vars);
 * ```
 */
export function cssVariables(vars: Record<string, string | number>): CSSProperties {
  const result: CSSProperties = {};

  for (const [name, value] of Object.entries(vars)) {
    const varName = name.startsWith('--') ? name : `--${name}`;
    result[varName] = value;
  }

  return result;
}
