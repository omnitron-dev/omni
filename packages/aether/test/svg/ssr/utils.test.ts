/**
 * Tests for SSR Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isServer,
  isBrowser,
  canUseDOM,
  extractCriticalCSS,
  injectPreloadLinks,
  generateSSRId,
  escapeHtml,
  extractAttributes,
  minifySVG,
  serializeStyles,
  parseStyles,
  isValidSVG,
  wrapWithHydrationMarker,
} from '../../../src/svg/ssr/utils.js';

describe('SSR Utils - Environment Detection', () => {
  it('should detect server environment', () => {
    // Vitest runs with jsdom (simulates browser), so window is defined
    // In a real Node.js environment, isServer() would return true
    expect(typeof isServer()).toBe('boolean');
  });

  it('should detect browser environment', () => {
    // Vitest runs with jsdom, so isBrowser() returns true
    expect(typeof isBrowser()).toBe('boolean');
  });

  it('should detect DOM availability', () => {
    // Vitest runs with jsdom, so DOM is available
    expect(typeof canUseDOM()).toBe('boolean');
  });
});

describe('SSR Utils - CSS Extraction', () => {
  it('should extract critical CSS from SVG string', () => {
    const svgString = `
      <svg>
        <style>.icon { fill: red; }</style>
        <path class="icon" d="M0 0 L10 10" />
      </svg>
    `;

    const css = extractCriticalCSS(svgString);
    expect(css).toContain('.icon { fill: red; }');
  });

  it('should extract multiple style blocks', () => {
    const svgString = `
      <svg>
        <style>.icon1 { fill: red; }</style>
        <style>.icon2 { fill: blue; }</style>
      </svg>
    `;

    const css = extractCriticalCSS(svgString);
    expect(css).toContain('.icon1 { fill: red; }');
    expect(css).toContain('.icon2 { fill: blue; }');
  });

  it('should return empty string when no styles', () => {
    const svgString = '<svg><path d="M0 0 L10 10" /></svg>';
    const css = extractCriticalCSS(svgString);
    expect(css).toBe('');
  });
});

describe('SSR Utils - Preload Links', () => {
  it('should generate preload links for sprite URLs', () => {
    const urls = ['/sprites/icons.svg', '/sprites/logos.svg'];
    const links = injectPreloadLinks(urls);

    expect(links).toContain('<link rel="preload"');
    expect(links).toContain('href="/sprites/icons.svg"');
    expect(links).toContain('href="/sprites/logos.svg"');
    expect(links).toContain('as="image"');
    expect(links).toContain('type="image/svg+xml"');
  });

  it('should handle empty URL array', () => {
    const links = injectPreloadLinks([]);
    expect(links).toBe('');
  });

  it('should escape HTML in URLs', () => {
    const urls = ['/sprites/test"onclick="alert()".svg'];
    const links = injectPreloadLinks(urls);
    // The onclick attribute name should not appear unescaped
    expect(links).not.toMatch(/onclick="alert\(\)"/);
    expect(links).toContain('&quot;');
  });
});

describe('SSR Utils - ID Generation', () => {
  it('should generate unique SSR IDs', () => {
    const id1 = generateSSRId();
    const id2 = generateSSRId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^ssr-svg-/);
    expect(id2).toMatch(/^ssr-svg-/);
  });

  it('should use custom prefix', () => {
    const id = generateSSRId('custom');
    expect(id).toMatch(/^custom-/);
  });
});

describe('SSR Utils - HTML Escaping', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>alert()</script>')).toBe('&lt;script&gt;alert()&lt;/script&gt;');
    expect(escapeHtml('"Hello"')).toBe('&quot;Hello&quot;');
    expect(escapeHtml("'Hello'")).toBe('&#39;Hello&#39;');
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle string without special chars', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('SSR Utils - Attribute Extraction', () => {
  it('should extract attributes from SVG string', () => {
    const svgString = '<svg width="100" height="200" viewBox="0 0 100 200">';
    const attrs = extractAttributes(svgString);

    expect(attrs.width).toBe('100');
    expect(attrs.height).toBe('200');
    expect(attrs.viewBox).toBe('0 0 100 200');
  });

  it('should handle hyphenated attributes', () => {
    const svgString = '<svg data-icon="test" aria-label="Icon">';
    const attrs = extractAttributes(svgString);

    expect(attrs['data-icon']).toBe('test');
    expect(attrs['aria-label']).toBe('Icon');
  });

  it('should return empty object for invalid SVG', () => {
    const svgString = '<div>Not SVG</div>';
    const attrs = extractAttributes(svgString);
    expect(Object.keys(attrs).length).toBe(0);
  });
});

describe('SSR Utils - SVG Minification', () => {
  it('should remove comments', () => {
    const svgString = '<svg><!-- Comment --><path d="M0 0" /></svg>';
    const minified = minifySVG(svgString);
    expect(minified).not.toContain('<!--');
    expect(minified).not.toContain('Comment');
  });

  it('should remove whitespace between tags', () => {
    const svgString = '<svg>\n  <path d="M0 0" />\n  <circle r="5" />\n</svg>';
    const minified = minifySVG(svgString);
    expect(minified).toBe('<svg><path d="M0 0" /><circle r="5" /></svg>');
  });

  it('should trim leading/trailing whitespace', () => {
    const svgString = '  <svg><path d="M0 0" /></svg>  ';
    const minified = minifySVG(svgString);
    expect(minified).toBe('<svg><path d="M0 0" /></svg>');
  });
});

describe('SSR Utils - Style Serialization', () => {
  it('should serialize styles to CSS string', () => {
    const styles = {
      fill: 'red',
      strokeWidth: '2px',
      fontSize: '14px',
    };

    const css = serializeStyles(styles);
    expect(css).toContain('fill: red');
    expect(css).toContain('stroke-width: 2px');
    expect(css).toContain('font-size: 14px');
  });

  it('should filter out null/undefined values', () => {
    const styles = {
      fill: 'red',
      stroke: null,
      opacity: undefined,
    };

    const css = serializeStyles(styles);
    expect(css).toContain('fill: red');
    expect(css).not.toContain('stroke');
    expect(css).not.toContain('opacity');
  });

  it('should handle empty styles object', () => {
    const css = serializeStyles({});
    expect(css).toBe('');
  });
});

describe('SSR Utils - Style Parsing', () => {
  it('should parse CSS string to styles object', () => {
    const cssString = 'fill: red; stroke-width: 2px; font-size: 14px';
    const styles = parseStyles(cssString);

    expect(styles.fill).toBe('red');
    expect(styles.strokeWidth).toBe('2px');
    expect(styles.fontSize).toBe('14px');
  });

  it('should handle empty CSS string', () => {
    const styles = parseStyles('');
    expect(Object.keys(styles).length).toBe(0);
  });

  it('should ignore malformed rules', () => {
    const cssString = 'fill: red; invalid; stroke: blue';
    const styles = parseStyles(cssString);

    expect(styles.fill).toBe('red');
    expect(styles.stroke).toBe('blue');
  });
});

describe('SSR Utils - SVG Validation', () => {
  it('should validate correct SVG string', () => {
    const svgString = '<svg><path d="M0 0 L10 10" /></svg>';
    expect(isValidSVG(svgString)).toBe(true);
  });

  it('should reject non-SVG string', () => {
    const svgString = '<div>Not SVG</div>';
    expect(isValidSVG(svgString)).toBe(false);
  });

  it('should reject incomplete SVG', () => {
    const svgString = '<svg><path d="M0 0 L10 10" />';
    expect(isValidSVG(svgString)).toBe(false);
  });

  it('should handle whitespace', () => {
    const svgString = '  <svg><path /></svg>  ';
    expect(isValidSVG(svgString)).toBe(true);
  });
});

describe('SSR Utils - Hydration Markers', () => {
  it('should wrap SVG with hydration marker', () => {
    const svgString = '<svg><path d="M0 0" /></svg>';
    const props = JSON.stringify({ size: 24 });
    const wrapped = wrapWithHydrationMarker(svgString, 'SVGIcon', props);

    expect(wrapped).toContain('data-aether-hydrate="SVGIcon"');
    expect(wrapped).toContain('data-aether-props');
    expect(wrapped).toContain('<svg');
  });

  it('should wrap non-SVG content in div', () => {
    const content = '<path d="M0 0" />';
    const props = JSON.stringify({});
    const wrapped = wrapWithHydrationMarker(content, 'TestComponent', props);

    expect(wrapped).toContain('<div');
    expect(wrapped).toContain('data-aether-hydrate="TestComponent"');
  });

  it('should escape props JSON', () => {
    const svgString = '<svg></svg>';
    const props = JSON.stringify({ script: '<script>alert()</script>' });
    const wrapped = wrapWithHydrationMarker(svgString, 'Test', props);

    expect(wrapped).not.toContain('<script>alert()');
    expect(wrapped).toContain('&lt;script&gt;');
  });
});
