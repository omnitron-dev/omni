/**
 * CSS Variable Generation
 *
 * Convert theme tokens to CSS custom properties with:
 * - Automatic CSS variable generation from theme tokens
 * - Scoped variable application
 * - Nested token flattening
 * - Runtime theme switching
 */

import type { Theme } from './defineTheme.js';

/**
 * Flatten nested object to CSS variable format
 *
 * @param obj - Nested object
 * @param prefix - Variable prefix
 * @param separator - Separator between levels
 * @returns Flattened object with CSS variable names
 *
 * @example
 * ```typescript
 * flattenObject({ primary: { 500: '#3b82f6' } }, 'color')
 * // Returns: { 'color-primary-500': '#3b82f6' }
 * ```
 */
function flattenObject(obj: any, prefix = '', separator = '-'): Record<string, string | number> {
  const result: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    const newKey = prefix ? `${prefix}${separator}${key}` : key;

    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      // Check if it's a color scale object with numeric keys
      const keys = Object.keys(value);
      const isColorScale = keys.some((k) => !isNaN(Number(k)));

      if (isColorScale) {
        // It's a color scale, flatten it
        Object.assign(result, flattenObject(value, newKey, separator));
      } else {
        // Regular nested object
        Object.assign(result, flattenObject(value, newKey, separator));
      }
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/**
 * Generate CSS custom properties from theme tokens
 *
 * @param theme - Theme object
 * @param prefix - CSS variable prefix (default: 'aether')
 * @returns CSS text with custom properties
 *
 * @example
 * ```typescript
 * const css = generateCSSVariables(theme);
 * // Returns CSS like:
 * // :root {
 * //   --aether-color-primary-500: #3b82f6;
 * //   --aether-spacing-4: 1rem;
 * // }
 * ```
 */
export function generateCSSVariables(theme: Theme, prefix = 'aether'): string {
  const variables: string[] = [];

  // Process each token category
  const categories = ['colors', 'typography', 'spacing', 'sizing', 'radius', 'shadow', 'zIndex', 'animation'];

  for (const category of categories) {
    const tokens = theme[category as keyof Theme];
    if (!tokens) continue;

    const categoryPrefix = category === 'colors' ? 'color' : category;
    const flattened = flattenObject(tokens, categoryPrefix);

    for (const [key, value] of Object.entries(flattened)) {
      variables.push(`  --${prefix}-${key}: ${value};`);
    }
  }

  // Process custom tokens
  if (theme.custom) {
    const flattened = flattenObject(theme.custom, 'custom');

    for (const [key, value] of Object.entries(flattened)) {
      variables.push(`  --${prefix}-${key}: ${value};`);
    }
  }

  // Process breakpoints
  if (theme.breakpoints) {
    const flattened = flattenObject(theme.breakpoints, 'breakpoint');

    for (const [key, value] of Object.entries(flattened)) {
      variables.push(`  --${prefix}-${key}: ${value};`);
    }
  }

  return `:root {\n${variables.join('\n')}\n}`;
}

/**
 * Generate scoped CSS variables for a specific selector
 *
 * @param theme - Theme object
 * @param selector - CSS selector (e.g., '.dark', '[data-theme="dark"]')
 * @param prefix - CSS variable prefix
 * @returns CSS text with scoped custom properties
 *
 * @example
 * ```typescript
 * const css = generateScopedVariables(darkTheme, '.dark');
 * // Returns CSS like:
 * // .dark {
 * //   --aether-color-background-primary: #111827;
 * // }
 * ```
 */
export function generateScopedVariables(theme: Theme, selector: string, prefix = 'aether'): string {
  const css = generateCSSVariables(theme, prefix);

  // Replace :root with selector
  return css.replace(':root', selector);
}

/**
 * Apply theme to DOM element
 *
 * @param theme - Theme object
 * @param element - DOM element (defaults to document.documentElement)
 * @param prefix - CSS variable prefix
 *
 * @example
 * ```typescript
 * applyTheme(lightTheme); // Apply to :root
 * applyTheme(darkTheme, document.body); // Apply to body
 * ```
 */
export function applyTheme(theme: Theme, element?: HTMLElement, prefix = 'aether'): void {
  const target = element || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;

  // Process each token category
  const categories = ['colors', 'typography', 'spacing', 'sizing', 'radius', 'shadow', 'zIndex', 'animation'];

  for (const category of categories) {
    const tokens = theme[category as keyof Theme];
    if (!tokens) continue;

    const categoryPrefix = category === 'colors' ? 'color' : category;
    const flattened = flattenObject(tokens, categoryPrefix);

    for (const [key, value] of Object.entries(flattened)) {
      target.style.setProperty(`--${prefix}-${key}`, String(value));
    }
  }

  // Process custom tokens
  if (theme.custom) {
    const flattened = flattenObject(theme.custom, 'custom');

    for (const [key, value] of Object.entries(flattened)) {
      target.style.setProperty(`--${prefix}-${key}`, String(value));
    }
  }

  // Store theme name as attribute
  target.setAttribute('data-theme', theme.name);
}

/**
 * Remove theme from DOM element
 *
 * @param element - DOM element
 * @param prefix - CSS variable prefix
 */
export function removeTheme(element?: HTMLElement, prefix = 'aether'): void {
  const target = element || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;

  // Remove all CSS variables with the prefix
  const styles = target.style;
  const toRemove: string[] = [];

  for (let i = 0; i < styles.length; i++) {
    const prop = styles[i];
    if (prop.startsWith(`--${prefix}-`)) {
      toRemove.push(prop);
    }
  }

  for (const prop of toRemove) {
    target.style.removeProperty(prop);
  }

  target.removeAttribute('data-theme');
}

/**
 * Get CSS variable value from theme token path
 *
 * @param path - Token path (e.g., 'colors.primary.500')
 * @param prefix - CSS variable prefix
 * @returns CSS variable reference
 *
 * @example
 * ```typescript
 * const color = getCSSVariable('colors.primary.500');
 * // Returns: 'var(--aether-color-primary-500)'
 * ```
 */
export function getCSSVariable(path: string, prefix = 'aether'): string {
  // Convert path to CSS variable name
  const parts = path.split('.');
  const varName = parts
    .map((part, i) => {
      // Convert 'colors' to 'color', keep others as is
      if (i === 0 && part === 'colors') return 'color';
      return part;
    })
    .join('-');

  return `var(--${prefix}-${varName})`;
}

/**
 * Create theme CSS variables map
 *
 * @param theme - Theme object
 * @param prefix - CSS variable prefix
 * @returns Map of token paths to CSS variable references
 *
 * @example
 * ```typescript
 * const vars = createThemeVars(theme);
 * // Access like: vars['colors.primary.500']
 * // Returns: 'var(--aether-color-primary-500)'
 * ```
 */
export function createThemeVars(theme: Theme, prefix = 'aether'): Record<string, string> {
  const vars: Record<string, string> = {};

  function processObject(obj: any, path: string[] = []) {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;

      const currentPath = [...path, key];

      if (typeof value === 'object' && !Array.isArray(value)) {
        processObject(value, currentPath);
      } else {
        const pathStr = currentPath.join('.');
        vars[pathStr] = getCSSVariable(pathStr, prefix);
      }
    }
  }

  // Process each token category
  const categories = ['colors', 'typography', 'spacing', 'sizing', 'radius', 'shadow', 'zIndex', 'animation'];

  for (const category of categories) {
    const tokens = theme[category as keyof Theme];
    if (!tokens) continue;

    processObject(tokens, [category]);
  }

  // Process custom tokens
  if (theme.custom) {
    processObject(theme.custom, ['custom']);
  }

  return vars;
}

/**
 * Generate TypeScript types for theme tokens
 *
 * @param theme - Theme object
 * @returns TypeScript type definition string
 *
 * @example
 * ```typescript
 * const types = generateThemeTypes(theme);
 * // Returns TypeScript interface definition
 * ```
 */
export function generateThemeTypes(theme: Theme): string {
  const vars = createThemeVars(theme);
  const paths = Object.keys(vars);

  const unionType = paths.map((path) => `'${path}'`).join(' | ');

  return `export type ThemeToken = ${unionType};`;
}

/**
 * Inject theme CSS into document
 *
 * @param theme - Theme object
 * @param scoped - Whether to scope to a selector (e.g., '.light')
 * @param prefix - CSS variable prefix
 * @returns Style element
 */
export function injectThemeCSS(theme: Theme, scoped?: string, prefix = 'aether'): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;

  const css = scoped ? generateScopedVariables(theme, scoped, prefix) : generateCSSVariables(theme, prefix);

  const style = document.createElement('style');
  style.setAttribute('data-aether-theme', theme.name);
  style.textContent = css;
  document.head.appendChild(style);

  return style;
}

/**
 * Remove theme CSS from document
 *
 * @param themeName - Theme name to remove
 */
export function removeThemeCSS(themeName: string): void {
  if (typeof document === 'undefined') return;

  const styles = document.querySelectorAll(`style[data-aether-theme="${themeName}"]`);
  styles.forEach((style) => style.remove());
}
