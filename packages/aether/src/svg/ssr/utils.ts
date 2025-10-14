/**
 * SSR Utilities
 *
 * Environment detection and utility functions for server-side rendering
 */

/**
 * Check if code is running on the server
 */
export function isServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * Check if code is running in a browser
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Check if DOM manipulation is possible
 */
export function canUseDOM(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement
  );
}

/**
 * Extract critical CSS from SVG elements
 * Useful for inlining styles during SSR
 */
export function extractCriticalCSS(svgString: string): string {
  const styleMatches = svgString.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);

  if (!styleMatches) {
    return '';
  }

  const allStyles = styleMatches
    .map(match => {
      const content = match.replace(/<\/?style[^>]*>/gi, '');
      return content.trim();
    })
    .filter(Boolean)
    .join('\n');

  return allStyles;
}

/**
 * Inject preload links for SVG sprites
 * Returns HTML link tags for preloading sprite resources
 */
export function injectPreloadLinks(spriteUrls: string[]): string {
  return spriteUrls
    .map(url => `<link rel="preload" as="image" type="image/svg+xml" href="${escapeHtml(url)}" />`)
    .join('\n');
}

/**
 * Generate unique ID for server-rendered elements
 */
export function generateSSRId(prefix: string = 'ssr-svg'): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return text.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

/**
 * Extract attributes from SVG element string
 */
export function extractAttributes(svgString: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const svgTag = svgString.match(/<svg[^>]*>/)?.[0] || '';

  const attrRegex = /(\w+(?:-\w+)*)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(svgTag)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) {
      attributes[key] = value;
    }
  }

  return attributes;
}

/**
 * Minify SVG string by removing unnecessary whitespace and comments
 */
export function minifySVG(svgString: string): string {
  return svgString
    // Remove comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove extra whitespace between tags
    .replace(/>\s+</g, '><')
    // Remove whitespace at start/end
    .trim();
}

/**
 * Serialize styles object to CSS string
 */
export function serializeStyles(styles: Record<string, any>): string {
  return Object.entries(styles)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${cssKey}: ${value}`;
    })
    .join('; ');
}

/**
 * Parse CSS string to styles object
 */
export function parseStyles(cssString: string): Record<string, string> {
  const styles: Record<string, string> = {};

  cssString.split(';').forEach(rule => {
    const [key, value] = rule.split(':').map(s => s.trim());
    if (key && value) {
      const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      styles[camelKey] = value;
    }
  });

  return styles;
}

/**
 * Check if SVG string is valid
 */
export function isValidSVG(svgString: string): boolean {
  return svgString.trim().startsWith('<svg') && svgString.trim().endsWith('</svg>');
}

/**
 * Wrap SVG in container with hydration marker
 */
export function wrapWithHydrationMarker(
  svgString: string,
  componentName: string,
  propsJson: string
): string {
  const marker = `data-aether-hydrate="${componentName}" data-aether-props="${escapeHtml(propsJson)}"`;

  // If it's a complete SVG element, add marker to svg tag
  if (svgString.trim().startsWith('<svg')) {
    return svgString.replace('<svg', `<svg ${marker}`);
  }

  // Otherwise wrap in a div
  return `<div ${marker}>${svgString}</div>`;
}

/**
 * Serialize props for SSR, handling signals and functions
 */
export function serializeProps(props: Record<string, any>): Record<string, any> {
  const serialized: Record<string, any> = {};

  for (const [key, value] of Object.entries(props)) {
    // Skip functions (event handlers)
    if (typeof value === 'function') {
      // Check if it's a signal by trying to call it
      try {
        const result = value();
        // If it returns a value, it's a signal - serialize the value
        if (result !== undefined) {
          serialized[key] = serializeValue(result);
        }
      } catch {
        // Not a signal, skip it
        continue;
      }
      continue;
    }

    // Serialize the value
    serialized[key] = serializeValue(value);
  }

  return serialized;
}

/**
 * Serialize a single value for SSR
 */
function serializeValue(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'function') {
    // Try to call it (might be a signal)
    try {
      return serializeValue(value());
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (typeof value === 'object') {
    const serialized: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      serialized[k] = serializeValue(v);
    }
    return serialized;
  }

  return value;
}

/**
 * Detect if code is in critical rendering path
 */
export function isCriticalPath(): boolean {
  if (isServer()) {
    // On server, consider initial render as critical
    return true;
  }

  // On client, check if page is still loading
  return typeof document !== 'undefined' && document.readyState === 'loading';
}

/**
 * SSR-safe IntersectionObserver mock
 * Returns a no-op observer that immediately triggers callback
 */
export function createSSRIntersectionObserver(
  callback: IntersectionObserverCallback
): IntersectionObserver | null {
  if (!isServer()) {
    return null; // Use native on client
  }

  // Create a mock that does nothing on server
  const mock = {
    observe: () => {},
    unobserve: () => {},
    disconnect: () => {},
    takeRecords: () => [],
    root: null,
    rootMargin: '',
    thresholds: [],
  } as unknown as IntersectionObserver;

  return mock;
}

/**
 * SSR-safe requestAnimationFrame mock
 * Returns a no-op function that immediately executes callback
 */
export function createSSRRequestAnimationFrame(): ((callback: FrameRequestCallback) => number) {
  if (!isServer()) {
    return requestAnimationFrame; // Use native on client
  }

  // On server, execute immediately with a fake timestamp
  return (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
}

/**
 * SSR-safe requestIdleCallback mock
 */
export function createSSRRequestIdleCallback(): ((
  callback: IdleRequestCallback,
  options?: IdleRequestOptions
) => number) {
  if (!isServer()) {
    return 'requestIdleCallback' in window
      ? window.requestIdleCallback.bind(window)
      : ((cb: IdleRequestCallback) => {
          const id = setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
          return id as unknown as number;
        });
  }

  // On server, execute immediately
  return (callback: IdleRequestCallback) => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    } as IdleDeadline);
    return 0;
  };
}

/**
 * Extract data attributes from element
 */
export function extractDataAttributes(element: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /data-([a-z0-9-]+)="([^"]*)"/gi;
  let match;

  while ((match = regex.exec(element)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) {
      attrs[key] = value;
    }
  }

  return attrs;
}

/**
 * Generate hydration hints for optimal client-side hydration
 */
export function generateHydrationHints(options: {
  hasAnimations?: boolean;
  hasInteractivity?: boolean;
  isAboveFold?: boolean;
  priority?: 'high' | 'medium' | 'low';
}): string {
  const hints: string[] = [];

  if (options.hasAnimations) {
    hints.push('has-animations');
  }

  if (options.hasInteractivity) {
    hints.push('has-interactivity');
  }

  if (options.isAboveFold) {
    hints.push('above-fold');
  }

  if (options.priority) {
    hints.push(`priority-${options.priority}`);
  }

  return hints.length > 0 ? `data-hydration-hints="${hints.join(' ')}"` : '';
}
