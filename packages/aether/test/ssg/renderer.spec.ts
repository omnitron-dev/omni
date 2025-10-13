/**
 * Renderer Tests
 */

import { describe, it, expect } from 'vitest';
import {
  renderJSX,
  renderHTMLElement,
  buildAttributes,
  escapeHTML,
  generateDocument,
  buildMetaTags,
} from '../../src/ssg/renderer.js';
import type { GeneratedPage } from '../../src/ssg/types.js';

describe('Renderer', () => {
  describe('renderJSX', () => {
    it('should render simple text', () => {
      const html = renderJSX('Hello World');
      expect(html).toBe('Hello World');
    });

    it('should render HTML element', () => {
      const jsx = {
        type: 'div',
        props: { children: 'Content' },
      };
      const html = renderJSX(jsx);
      expect(html).toBe('<div>Content</div>');
    });

    it('should render nested elements', () => {
      const jsx = {
        type: 'div',
        props: {
          children: {
            type: 'span',
            props: { children: 'Nested' },
          },
        },
      };
      const html = renderJSX(jsx);
      expect(html).toBe('<div><span>Nested</span></div>');
    });

    it('should render array of children', () => {
      const jsx = {
        type: 'ul',
        props: {
          children: [
            { type: 'li', props: { children: 'Item 1' } },
            { type: 'li', props: { children: 'Item 2' } },
          ],
        },
      };
      const html = renderJSX(jsx);
      expect(html).toContain('<li>Item 1</li>');
      expect(html).toContain('<li>Item 2</li>');
    });
  });

  describe('renderHTMLElement', () => {
    it('should render element with attributes', () => {
      const html = renderHTMLElement('div', {
        id: 'test',
        className: 'container',
        children: 'Content',
      });
      expect(html).toContain('id="test"');
      expect(html).toContain('class="container"');
      expect(html).toContain('Content');
    });

    it('should handle self-closing tags', () => {
      const html = renderHTMLElement('img', {
        src: '/image.jpg',
        alt: 'Test',
      });
      expect(html).toContain('<img');
      expect(html).toContain('/>');
    });

    it('should handle innerHTML', () => {
      const html = renderHTMLElement('div', {
        innerHTML: '<strong>Bold</strong>',
      });
      expect(html).toBe('<div><strong>Bold</strong></div>');
    });
  });

  describe('buildAttributes', () => {
    it('should build attributes string', () => {
      const attrs = buildAttributes({
        id: 'test',
        className: 'container',
        'data-value': '123',
      });
      expect(attrs).toContain('id="test"');
      expect(attrs).toContain('class="container"');
      expect(attrs).toContain('data-value="123"');
    });

    it('should skip event handlers', () => {
      const attrs = buildAttributes({
        onClick: () => {},
        onSubmit: () => {},
      });
      expect(attrs).toBe('');
    });

    it('should handle boolean attributes', () => {
      const attrs = buildAttributes({
        disabled: true,
        hidden: false,
      });
      expect(attrs).toContain('disabled');
      expect(attrs).not.toContain('hidden');
    });
  });

  describe('escapeHTML', () => {
    it('should escape special characters', () => {
      const escaped = escapeHTML('<script>alert("xss")</script>');
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;');
      expect(escaped).toContain('&gt;');
    });

    it('should escape quotes', () => {
      const escaped = escapeHTML('"test"');
      expect(escaped).toContain('&quot;');
    });
  });

  describe('generateDocument', () => {
    it('should generate complete HTML document', () => {
      const page: GeneratedPage = {
        path: '/',
        html: '<div>Content</div>',
        props: {},
        generatedAt: new Date(),
      };

      const doc = generateDocument(page);

      expect(doc).toContain('<!DOCTYPE html>');
      expect(doc).toContain('<html');
      expect(doc).toContain('<head>');
      expect(doc).toContain('<body>');
      expect(doc).toContain('<div>Content</div>');
    });

    it('should include meta tags', () => {
      const page: GeneratedPage = {
        path: '/',
        html: '<div>Content</div>',
        props: {},
        meta: {
          title: 'Test Page',
          description: 'Test description',
        },
        generatedAt: new Date(),
      };

      const doc = generateDocument(page);

      expect(doc).toContain('<title>Test Page</title>');
      expect(doc).toContain('name="description"');
    });
  });

  describe('buildMetaTags', () => {
    it('should build meta tags', () => {
      const tags = buildMetaTags({
        canonical: 'https://example.com',
        ogTitle: 'Test',
        ogImage: '/image.jpg',
      });

      expect(tags).toContain('rel="canonical"');
      expect(tags).toContain('property="og:title"');
      expect(tags).toContain('property="og:image"');
    });
  });
});
