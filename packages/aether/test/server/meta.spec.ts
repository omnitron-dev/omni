/**
 * @fileoverview Comprehensive tests for Meta Management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderHead,
  collectMeta,
  injectMeta,
  updateMeta,
  createHeadContext,
  getHeadContext,
  setHeadContext,
  createOpenGraphTags,
  createTwitterCardTags,
  createJSONLD,
} from '../../src/server/meta.js';
import type { HeadContext } from '../../src/server/types.js';

// Mock DOM environment for client-side tests
const createMockDocument = () => {
  const elements: any[] = [];
  const head = {
    appendChild: vi.fn((element) => elements.push(element)),
  };

  return {
    head,
    title: '',
    querySelector: vi.fn((selector: string) => elements.find((el) => {
        if (selector.includes('name=')) {
          const match = selector.match(/name="([^"]+)"/);
          return match && el.getAttribute('name') === match[1];
        }
        if (selector.includes('property=')) {
          const match = selector.match(/property="([^"]+)"/);
          return match && el.getAttribute('property') === match[1];
        }
        if (selector.includes('rel=')) {
          const match = selector.match(/rel="([^"]+)"/);
          return match && el.rel === match[1];
        }
        return false;
      })),
    createElement: vi.fn((tagName: string) => {
      const element = {
        tagName: tagName.toUpperCase(),
        attributes: {} as any,
        setAttribute: vi.fn((name: string, value: string) => {
          element.attributes[name] = value;
        }),
        getAttribute: vi.fn((name: string) => element.attributes[name]),
        rel: '',
        href: '',
      };
      return element;
    }),
  };
};

describe('Meta Management', () => {
  let context: HeadContext;

  beforeEach(() => {
    context = createHeadContext();
    setHeadContext(context);
  });

  afterEach(() => {
    setHeadContext(null);
  });

  describe('createHeadContext', () => {
    it('should create empty head context', () => {
      const ctx = createHeadContext();

      expect(ctx.title).toBeUndefined();
      expect(ctx.meta).toEqual([]);
      expect(ctx.links).toEqual([]);
      expect(ctx.scripts).toEqual([]);
      expect(ctx.styles).toEqual([]);
    });

    it('should create independent contexts', () => {
      const ctx1 = createHeadContext();
      const ctx2 = createHeadContext();

      ctx1.title = 'Context 1';
      ctx2.title = 'Context 2';

      expect(ctx1.title).toBe('Context 1');
      expect(ctx2.title).toBe('Context 2');
    });
  });

  describe('getHeadContext / setHeadContext', () => {
    it('should get and set global context', () => {
      const ctx = createHeadContext();
      setHeadContext(ctx);

      expect(getHeadContext()).toBe(ctx);
    });

    it('should allow clearing context', () => {
      const ctx = createHeadContext();
      setHeadContext(ctx);

      setHeadContext(null);

      expect(getHeadContext()).toBeNull();
    });
  });

  describe('collectMeta', () => {
    it('should collect title', () => {
      collectMeta(context, { title: 'Test Page' });

      expect(context.title).toBe('Test Page');
    });

    it('should collect description', () => {
      collectMeta(context, { description: 'Page description' });

      expect(context.meta).toContainEqual({
        name: 'description',
        content: 'Page description',
      });
    });

    it('should collect Open Graph tags', () => {
      collectMeta(context, {
        title: 'OG Title',
        description: 'OG Description',
        ogImage: '/og-image.jpg',
      });

      expect(context.meta).toContainEqual({
        property: 'og:title',
        content: 'OG Title',
      });

      expect(context.meta).toContainEqual({
        property: 'og:description',
        content: 'OG Description',
      });

      expect(context.meta).toContainEqual({
        property: 'og:image',
        content: '/og-image.jpg',
      });
    });

    it('should use explicit OG values over defaults', () => {
      collectMeta(context, {
        title: 'Page Title',
        ogTitle: 'Different OG Title',
      });

      const ogTitle = context.meta.find((m) => m.property === 'og:title');
      expect(ogTitle?.content).toBe('Different OG Title');
    });

    it('should collect canonical URL', () => {
      collectMeta(context, {
        canonical: 'https://example.com/page',
      });

      expect(context.links).toContainEqual({
        rel: 'canonical',
        href: 'https://example.com/page',
      });
    });

    it('should collect custom meta tags', () => {
      collectMeta(context, {
        'twitter:card': 'summary_large_image',
        'twitter:site': '@username',
        author: 'John Doe',
      });

      expect(context.meta).toContainEqual({
        property: 'twitter:card',
        content: 'summary_large_image',
      });

      expect(context.meta).toContainEqual({
        property: 'twitter:site',
        content: '@username',
      });

      expect(context.meta).toContainEqual({
        name: 'author',
        content: 'John Doe',
      });
    });

    it('should ignore undefined values', () => {
      collectMeta(context, {
        title: 'Title',
        description: undefined,
      });

      expect(context.title).toBe('Title');
      expect(context.meta.find((m) => m.name === 'description')).toBeUndefined();
    });
  });

  describe('renderHead', () => {
    it('should render title tag', () => {
      context.title = 'Test Page';

      const html = renderHead(context);

      expect(html).toContain('<title>Test Page</title>');
    });

    it('should render meta tags', () => {
      context.meta.push({
        name: 'description',
        content: 'Page description',
      });

      const html = renderHead(context);

      expect(html).toContain('<meta name="description" content="Page description">');
    });

    it('should render link tags', () => {
      context.links.push({
        rel: 'canonical',
        href: 'https://example.com/page',
      });

      const html = renderHead(context);

      expect(html).toContain('<link rel="canonical" href="https://example.com/page">');
    });

    it('should render script tags', () => {
      context.scripts.push({
        src: '/script.js',
        async: true,
      });

      const html = renderHead(context);

      expect(html).toContain('<script');
      expect(html).toContain('src="/script.js"');
      expect(html).toContain('async');
    });

    it('should render style tags', () => {
      context.styles.push({
        content: 'body { margin: 0; }',
      });

      const html = renderHead(context);

      expect(html).toContain('<style>body { margin: 0; }</style>');
    });

    it('should render inline scripts', () => {
      context.scripts.push({
        content: 'console.log("test");',
        type: 'application/javascript',
      });

      const html = renderHead(context);

      expect(html).toContain('<script');
      expect(html).toContain('console.log("test");');
    });

    it('should escape HTML in meta content', () => {
      context.meta.push({
        name: 'description',
        content: 'Test <script>alert("xss")</script>',
      });

      const html = renderHead(context);

      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should handle empty context', () => {
      const emptyContext = createHeadContext();

      const html = renderHead(emptyContext);

      expect(html).toBe('');
    });

    it('should use current context if none provided', () => {
      context.title = 'Current Context';

      const html = renderHead();

      expect(html).toContain('<title>Current Context</title>');
    });
  });

  describe('injectMeta', () => {
    it('should inject meta tags before </head>', () => {
      context.title = 'Injected Title';
      const html = '<html><head></head><body></body></html>';

      const result = injectMeta(html, context);

      expect(result).toContain('<title>Injected Title</title>');
      expect(result.indexOf('<title>')).toBeLessThan(result.indexOf('</head>'));
    });

    it('should inject after <head> if no closing tag', () => {
      context.title = 'Title';
      const html = '<html><head><body></body></html>';

      const result = injectMeta(html, context);

      expect(result).toContain('<title>Title</title>');
    });

    it('should warn if no <head> tag found', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation();

      context.title = 'Title';
      const html = '<html><body></body></html>';

      const result = injectMeta(html, context);

      expect(consoleWarn).toHaveBeenCalledWith('No <head> tag found in HTML');
      expect(result).toBe(html); // Unchanged

      consoleWarn.mockRestore();
    });

    it('should inject multiple meta tags', () => {
      context.title = 'Page';
      context.meta.push(
        { name: 'description', content: 'Desc' },
        { property: 'og:title', content: 'OG Title' }
      );

      const html = '<html><head></head><body></body></html>';

      const result = injectMeta(html, context);

      expect(result).toContain('<title>Page</title>');
      expect(result).toContain('name="description"');
      expect(result).toContain('property="og:title"');
    });
  });

  describe('updateMeta (client-side)', () => {
    it('should update document title', () => {
      const mockDoc = createMockDocument();
      (global as any).document = mockDoc;

      updateMeta({ title: 'New Title' });

      expect(mockDoc.title).toBe('New Title');

      delete (global as any).document;
    });

    it('should update meta tags', () => {
      const mockDoc = createMockDocument();
      (global as any).document = mockDoc;

      updateMeta({
        description: 'New Description',
      });

      expect(mockDoc.createElement).toHaveBeenCalledWith('meta');

      delete (global as any).document;
    });

    it('should update Open Graph tags', () => {
      const mockDoc = createMockDocument();
      (global as any).document = mockDoc;

      updateMeta({
        ogTitle: 'OG Title',
        ogDescription: 'OG Description',
        ogImage: '/og.jpg',
      });

      expect(mockDoc.createElement).toHaveBeenCalled();

      delete (global as any).document;
    });

    it('should update canonical link', () => {
      const mockDoc = createMockDocument();
      (global as any).document = mockDoc;

      updateMeta({
        canonical: 'https://example.com/page',
      });

      expect(mockDoc.createElement).toHaveBeenCalled();

      delete (global as any).document;
    });

    it('should warn in non-browser environment', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation();

      updateMeta({ title: 'Title' });

      expect(consoleWarn).toHaveBeenCalledWith(
        'updateMeta called in non-browser environment'
      );

      consoleWarn.mockRestore();
    });

    it('should handle custom tags', () => {
      const mockDoc = createMockDocument();
      (global as any).document = mockDoc;

      updateMeta({
        'twitter:card': 'summary',
        author: 'John Doe',
      });

      expect(mockDoc.createElement).toHaveBeenCalled();

      delete (global as any).document;
    });

    it('should update existing tags instead of creating new ones', () => {
      const existingMeta = {
        tagName: 'META',
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => 'description'),
      };

      const mockDoc = createMockDocument();
      mockDoc.querySelector = vi.fn(() => existingMeta);
      (global as any).document = mockDoc;

      updateMeta({ description: 'Updated' });

      expect(existingMeta.setAttribute).toHaveBeenCalledWith('content', 'Updated');

      delete (global as any).document;
    });
  });

  describe('createOpenGraphTags', () => {
    it('should create OG tags object', () => {
      const tags = createOpenGraphTags({
        title: 'Article Title',
        description: 'Article description',
        image: '/article.jpg',
        type: 'article',
        url: 'https://example.com/article',
        siteName: 'My Site',
      });

      expect(tags.ogTitle).toBe('Article Title');
      expect(tags.ogDescription).toBe('Article description');
      expect(tags.ogImage).toBe('/article.jpg');
      expect(tags['og:type']).toBe('article');
      expect(tags['og:url']).toBe('https://example.com/article');
      expect(tags['og:site_name']).toBe('My Site');
    });

    it('should default type to website', () => {
      const tags = createOpenGraphTags({
        title: 'Page',
      });

      expect(tags['og:type']).toBe('website');
    });

    it('should handle optional fields', () => {
      const tags = createOpenGraphTags({
        title: 'Title Only',
      });

      expect(tags.ogTitle).toBe('Title Only');
      expect(tags.ogDescription).toBeUndefined();
      expect(tags.ogImage).toBeUndefined();
    });
  });

  describe('createTwitterCardTags', () => {
    it('should create Twitter Card tags', () => {
      const tags = createTwitterCardTags({
        card: 'summary_large_image',
        title: 'Tweet Title',
        description: 'Tweet description',
        image: '/twitter.jpg',
        site: '@sitehandle',
        creator: '@creator',
      });

      expect(tags['twitter:card']).toBe('summary_large_image');
      expect(tags['twitter:title']).toBe('Tweet Title');
      expect(tags['twitter:description']).toBe('Tweet description');
      expect(tags['twitter:image']).toBe('/twitter.jpg');
      expect(tags['twitter:site']).toBe('@sitehandle');
      expect(tags['twitter:creator']).toBe('@creator');
    });

    it('should default card to summary_large_image', () => {
      const tags = createTwitterCardTags({
        title: 'Title',
      });

      expect(tags['twitter:card']).toBe('summary_large_image');
    });

    it('should support different card types', () => {
      const summary = createTwitterCardTags({
        card: 'summary',
        title: 'Summary',
      });

      const app = createTwitterCardTags({
        card: 'app',
        title: 'App',
      });

      const player = createTwitterCardTags({
        card: 'player',
        title: 'Player',
      });

      expect(summary['twitter:card']).toBe('summary');
      expect(app['twitter:card']).toBe('app');
      expect(player['twitter:card']).toBe('player');
    });
  });

  describe('createJSONLD', () => {
    it('should create JSON-LD script tag', () => {
      const data = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Article Title',
        author: {
          '@type': 'Person',
          name: 'John Doe',
        },
      };

      const script = createJSONLD(data);

      expect(script.type).toBe('application/ld+json');
      expect(script.content).toBe(JSON.stringify(data));
    });

    it('should handle complex structured data', () => {
      const data = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Product Name',
        offers: {
          '@type': 'Offer',
          price: '99.99',
          priceCurrency: 'USD',
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.5',
          reviewCount: '123',
        },
      };

      const script = createJSONLD(data);

      expect(script.content).toContain('Product');
      expect(script.content).toContain('AggregateRating');
    });

    it('should properly serialize nested objects', () => {
      const data = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '123 Main St',
          addressLocality: 'City',
          addressRegion: 'State',
          postalCode: '12345',
        },
      };

      const script = createJSONLD(data);

      const parsed = JSON.parse(script.content || '{}');
      expect(parsed.address.streetAddress).toBe('123 Main St');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings in meta values', () => {
      collectMeta(context, {
        title: '',
        description: '',
      });

      expect(context.title).toBe('');
    });

    it('should handle very long meta content', () => {
      const longContent = 'a'.repeat(10000);

      collectMeta(context, {
        description: longContent,
      });

      const html = renderHead(context);

      expect(html).toContain(longContent);
    });

    it('should handle special characters in meta content', () => {
      collectMeta(context, {
        title: 'Title with "quotes" & <tags>',
      });

      const html = renderHead(context);

      expect(html).toContain('&quot;');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });

    it('should handle multiple scripts with same type', () => {
      context.scripts.push(
        { content: 'script1();', type: 'text/javascript' },
        { content: 'script2();', type: 'text/javascript' }
      );

      const html = renderHead(context);

      expect(html).toContain('script1()');
      expect(html).toContain('script2()');
    });

    it('should handle defer and async script attributes', () => {
      context.scripts.push({
        src: '/script.js',
        defer: true,
        async: false,
      });

      const html = renderHead(context);

      expect(html).toContain('defer');
      expect(html).not.toContain('async');
    });

    it('should handle links with additional attributes', () => {
      context.links.push({
        rel: 'stylesheet',
        href: '/style.css',
        media: 'screen',
        type: 'text/css',
      });

      const html = renderHead(context);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="/style.css"');
      expect(html).toContain('media="screen"');
      expect(html).toContain('type="text/css"');
    });
  });

  describe('Integration', () => {
    it('should collect and render complete page meta', () => {
      collectMeta(context, {
        title: 'Complete Page',
        description: 'Full description',
        canonical: 'https://example.com/page',
        ogTitle: 'OG Title',
        ogDescription: 'OG Description',
        ogImage: '/og.jpg',
        'og:type': 'website',
        'twitter:card': 'summary_large_image',
        'twitter:site': '@site',
      });

      const html = renderHead(context);

      expect(html).toContain('<title>Complete Page</title>');
      expect(html).toContain('name="description"');
      expect(html).toContain('rel="canonical"');
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="twitter:card"');
    });

    it('should inject complete meta into HTML document', () => {
      collectMeta(context, {
        title: 'Page Title',
        description: 'Page description',
      });

      const doc = '<!DOCTYPE html><html><head></head><body>Content</body></html>';

      const result = injectMeta(doc, context);

      expect(result).toContain('<title>Page Title</title>');
      expect(result).toContain('name="description"');
      expect(result).toContain('Content'); // Body preserved
    });
  });
});
