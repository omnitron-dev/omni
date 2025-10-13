/**
 * CSS-in-JS Runtime
 *
 * Core runtime for dynamic style injection and management with:
 * - Dynamic style sheet creation
 * - Runtime style injection with deduplication
 * - SSR style extraction
 * - Automatic cleanup
 * - Media queries and pseudo-selectors support
 */

/**
 * Style rule interface
 */
export interface StyleRule {
  selector: string;
  properties: Record<string, string | number>;
  media?: string;
  pseudoSelector?: string;
}

/**
 * Style sheet instance
 */
export interface StyleSheet {
  id: string;
  element: HTMLStyleElement | null;
  rules: Map<string, StyleRule>;
  insert(rule: StyleRule): string;
  remove(className: string): void;
  clear(): void;
  extractCSS(): string;
}

/**
 * Style injection options
 */
export interface InjectStylesOptions {
  media?: string;
  pseudoSelectors?: Record<string, Record<string, string | number>>;
  nonce?: string;
  sheetId?: string;
}

/**
 * SSR style collection
 */
interface SSRStyleCollection {
  css: string;
  ids: Set<string>;
}

// Global state
let styleIdCounter = 0;
let isSSR = typeof window === 'undefined';
const styleSheets = new Map<string, StyleSheet>();
const ssrStyles: SSRStyleCollection = { css: '', ids: new Set() };
const injectedStyles = new Map<string, string>(); // Hash -> className
let globalSheet: StyleSheet | null = null;

/**
 * Generate a unique class name
 */
function generateClassName(prefix = 'aether'): string {
  return `${prefix}-${(styleIdCounter++).toString(36)}`;
}

/**
 * Hash a style object to detect duplicates
 */
function hashStyleObject(properties: Record<string, string | number>, media?: string, pseudo?: string): string {
  const sortedProps = Object.keys(properties)
    .sort()
    .map((key) => `${key}:${properties[key]}`)
    .join(';');
  return `${media || ''}|${pseudo || ''}|${sortedProps}`;
}

/**
 * Convert property name to CSS format (camelCase to kebab-case)
 */
function toCSSProperty(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Convert style object to CSS string
 */
function styleToCSSString(properties: Record<string, string | number>): string {
  return Object.entries(properties)
    .map(([key, value]) => {
      const cssKey = toCSSProperty(key);
      const cssValue = typeof value === 'number' && !unitlessProperties.has(key) ? `${value}px` : value;
      return `  ${cssKey}: ${cssValue};`;
    })
    .join('\n');
}

/**
 * CSS properties that don't need px suffix
 */
const unitlessProperties = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexPositive',
  'flexShrink',
  'flexNegative',
  'flexOrder',
  'gridArea',
  'gridRow',
  'gridRowEnd',
  'gridRowSpan',
  'gridRowStart',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnSpan',
  'gridColumnStart',
  'fontWeight',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
  'fillOpacity',
  'floodOpacity',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
]);

/**
 * Create a new style sheet
 */
export function createStyleSheet(id?: string): StyleSheet {
  const sheetId = id || `aether-styles-${Date.now()}`;

  let element: HTMLStyleElement | null = null;

  if (!isSSR) {
    element = document.createElement('style');
    element.setAttribute('data-aether', sheetId);
    document.head.appendChild(element);
  }

  const rules = new Map<string, StyleRule>();

  const sheet: StyleSheet = {
    id: sheetId,
    element,
    rules,

    insert(rule: StyleRule): string {
      const hash = hashStyleObject(rule.properties, rule.media, rule.pseudoSelector);

      // Check if already injected (deduplication)
      if (injectedStyles.has(hash)) {
        return injectedStyles.get(hash)!;
      }

      const className = generateClassName();
      const selector = rule.selector || `.${className}`;

      rules.set(className, { ...rule, selector });

      // Build CSS string
      let css = '';
      const properties = styleToCSSString(rule.properties);

      if (rule.pseudoSelector) {
        css = `${selector}${rule.pseudoSelector} {\n${properties}\n}`;
      } else {
        css = `${selector} {\n${properties}\n}`;
      }

      if (rule.media) {
        css = `@media ${rule.media} {\n${css}\n}`;
      }

      // Inject or collect for SSR
      if (isSSR) {
        ssrStyles.css += css + '\n';
        ssrStyles.ids.add(className);
      } else if (element?.sheet) {
        try {
          element.sheet.insertRule(css, element.sheet.cssRules.length);
        } catch (e) {
          console.warn('Failed to insert CSS rule:', css, e);
        }
      }

      injectedStyles.set(hash, className);
      return className;
    },

    remove(className: string): void {
      const rule = rules.get(className);
      if (!rule) return;

      rules.delete(className);

      if (!isSSR && element?.sheet) {
        // Find and remove the rule
        const cssSheet = element.sheet;
        for (let i = 0; i < cssSheet.cssRules.length; i++) {
          const cssRule = cssSheet.cssRules[i];
          if (cssRule instanceof CSSStyleRule && cssRule.selectorText === rule.selector) {
            cssSheet.deleteRule(i);
            break;
          }
        }
      }
    },

    clear(): void {
      rules.clear();
      if (!isSSR && element) {
        element.textContent = '';
      }
    },

    extractCSS(): string {
      const cssRules: string[] = [];

      for (const rule of rules.values()) {
        const properties = styleToCSSString(rule.properties);
        let css = '';

        if (rule.pseudoSelector) {
          css = `${rule.selector}${rule.pseudoSelector} {\n${properties}\n}`;
        } else {
          css = `${rule.selector} {\n${properties}\n}`;
        }

        if (rule.media) {
          css = `@media ${rule.media} {\n${css}\n}`;
        }

        cssRules.push(css);
      }

      return cssRules.join('\n\n');
    },
  };

  styleSheets.set(sheetId, sheet);
  return sheet;
}

/**
 * Get or create the global style sheet
 */
export function getGlobalSheet(): StyleSheet {
  if (!globalSheet) {
    globalSheet = createStyleSheet('aether-global');
  }
  return globalSheet;
}

/**
 * Inject styles at runtime
 */
export function injectStyles(properties: Record<string, string | number>, options: InjectStylesOptions = {}): string {
  const sheet = options.sheetId ? styleSheets.get(options.sheetId) || getGlobalSheet() : getGlobalSheet();

  // Apply nonce if provided
  if (!isSSR && options.nonce && sheet.element) {
    sheet.element.setAttribute('nonce', options.nonce);
  }

  // Base styles
  const className = sheet.insert({
    selector: '',
    properties,
    media: options.media,
  });

  // Pseudo selectors
  if (options.pseudoSelectors) {
    for (const [pseudo, pseudoProps] of Object.entries(options.pseudoSelectors)) {
      sheet.insert({
        selector: `.${className}`,
        properties: pseudoProps,
        pseudoSelector: pseudo.startsWith(':') ? pseudo : `:${pseudo}`,
        media: options.media,
      });
    }
  }

  return className;
}

/**
 * Extract styles for SSR
 */
export function extractStyles(): string {
  if (!isSSR) {
    // In browser, extract from all style sheets
    const allCSS: string[] = [];
    for (const sheet of styleSheets.values()) {
      const css = sheet.extractCSS();
      if (css) allCSS.push(css);
    }
    return allCSS.join('\n\n');
  }

  return ssrStyles.css;
}

/**
 * Get SSR style tags for HTML injection
 */
export function getSSRStyleTags(nonce?: string): string {
  const css = extractStyles();
  if (!css) return '';

  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<style data-aether="ssr"${nonceAttr}>\n${css}\n</style>`;
}

/**
 * Cleanup styles
 */
export function cleanupStyles(sheetId?: string): void {
  if (sheetId) {
    const sheet = styleSheets.get(sheetId);
    if (sheet) {
      if (sheet.element?.parentNode) {
        sheet.element.parentNode.removeChild(sheet.element);
      }
      styleSheets.delete(sheetId);
    }
  } else {
    // Clean up all sheets
    for (const [id, sheet] of styleSheets.entries()) {
      if (sheet.element?.parentNode) {
        sheet.element.parentNode.removeChild(sheet.element);
      }
      styleSheets.delete(id);
    }
    injectedStyles.clear();
    globalSheet = null;
  }
}

/**
 * Clear SSR styles (useful for testing)
 */
export function clearSSRStyles(): void {
  ssrStyles.css = '';
  ssrStyles.ids.clear();
}

/**
 * Reset style ID counter (useful for testing)
 */
export function resetStyleIdCounter(): void {
  styleIdCounter = 0;
}

/**
 * Check if running in SSR mode
 */
export function isServerSide(): boolean {
  return isSSR;
}

/**
 * Set SSR mode (useful for testing)
 */
export function setSSRMode(ssr: boolean): void {
  isSSR = ssr;
}
