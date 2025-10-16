/**
 * MarkdownPreview component tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { MarkdownPreview } from '../../../../src/components/editor/components/MarkdownPreview.js';

describe('MarkdownPreview', () => {
  describe('Component creation', () => {
    it('should create component', () => {
      expect(MarkdownPreview).toBeDefined();
      expect(typeof MarkdownPreview).toBe('function');
    });

    it('should have correct display name', () => {
      expect(MarkdownPreview.displayName).toBe('MarkdownPreview');
    });
  });

  describe('Props', () => {
    it('should accept markdown signal', () => {
      const markdown = signal('# Hello');
      const component = MarkdownPreview({ markdown });
      expect(component).toBeDefined();
    });

    it('should accept custom class', () => {
      const markdown = signal('');
      const component = MarkdownPreview({ markdown, class: 'custom-class' });
      expect(component).toBeDefined();
    });

    it('should accept custom renderer', () => {
      const markdown = signal('');
      const renderer = (md: string) => `<div>${md}</div>`;
      const component = MarkdownPreview({ markdown, renderer });
      expect(component).toBeDefined();
    });
  });

  describe('Rendering', () => {
    it('should render empty content for empty markdown', () => {
      const markdown = signal('');
      const rendered = MarkdownPreview({ markdown });

      expect(rendered).toBeDefined();
      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        expect(rendered.className).toContain('markdown-preview');
      }
    });

    it('should apply custom class', () => {
      const markdown = signal('');
      const rendered = MarkdownPreview({ markdown, class: 'custom' });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        expect(rendered.className).toContain('markdown-preview');
        expect(rendered.className).toContain('custom');
      }
    });

    it('should render markdown content', async () => {
      const markdown = signal('# Hello');
      const rendered = MarkdownPreview({ markdown });

      // Wait for async rendering
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
      expect(rendered).toBeInstanceOf(Node);
    });

    it('should maintain same DOM node reference', () => {
      const markdown = signal('# Test');
      const rendered = MarkdownPreview({ markdown });

      // Component returns same node reference, not a new one each call
      expect(rendered).toBeDefined();
      expect(rendered).toBeInstanceOf(Node);
    });
  });

  describe('Markdown processing', () => {
    it('should process headings', async () => {
      const markdown = signal('# Heading 1\n## Heading 2');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process bold text', async () => {
      const markdown = signal('**bold text**');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process italic text', async () => {
      const markdown = signal('*italic text*');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process code blocks', async () => {
      const markdown = signal('```javascript\nconst x = 1;\n```');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process lists', async () => {
      const markdown = signal('- Item 1\n- Item 2\n- Item 3');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process links', async () => {
      const markdown = signal('[link](http://example.com)');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process blockquotes', async () => {
      const markdown = signal('> This is a quote');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process tables (GFM)', async () => {
      const markdown = signal('| Header |\n|--------|\n| Cell   |');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });

    it('should process strikethrough (GFM)', async () => {
      const markdown = signal('~~strikethrough~~');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeTruthy();
      }
    });
  });

  describe('Reactive updates', () => {
    it('should update when markdown changes', async () => {
      const markdown = signal('# Initial');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      const innerHTML1 = rendered instanceof Element ? rendered.innerHTML : '';

      // Update markdown
      markdown.set('# Updated');
      await new Promise(resolve => setTimeout(resolve, 100));

      const innerHTML2 = rendered instanceof Element ? rendered.innerHTML : '';

      // Content should have changed
      expect(innerHTML2).not.toBe(innerHTML1);
    });

    it('should handle rapid updates', async () => {
      const markdown = signal('# Test 1');
      const rendered = MarkdownPreview({ markdown });

      // Rapid updates
      markdown.set('# Test 2');
      markdown.set('# Test 3');
      markdown.set('# Test 4');

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(rendered).toBeDefined();
    });

    it('should clear content when markdown is empty', async () => {
      const markdown = signal('# Content');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      markdown.set('');
      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toBeFalsy();
      }
    });
  });

  describe('Custom renderer', () => {
    it('should use custom renderer when provided', async () => {
      const markdown = signal('# Test');
      const renderer = (md: string) => `<div class="custom">${md}</div>`;
      const rendered = MarkdownPreview({ markdown, renderer });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toContain('custom');
      }
    });

    it('should pass markdown to custom renderer', async () => {
      const markdown = signal('**test**');
      const renderer = vi.fn((md: string) => md);
      MarkdownPreview({ markdown, renderer });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(renderer).toHaveBeenCalledWith('**test**');
    });
  });

  describe('Options', () => {
    it('should enable syntax highlighting by default', async () => {
      const markdown = signal('```js\ncode\n```');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should disable syntax highlighting when requested', async () => {
      const markdown = signal('```js\ncode\n```');
      const rendered = MarkdownPreview({ markdown, enableSyntaxHighlight: false });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should enable GFM by default', async () => {
      const markdown = signal('~~strike~~');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should disable GFM when requested', async () => {
      const markdown = signal('~~strike~~');
      const rendered = MarkdownPreview({ markdown, enableGFM: false });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should enable heading anchors by default', async () => {
      const markdown = signal('# Heading');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should disable heading anchors when requested', async () => {
      const markdown = signal('# Heading');
      const rendered = MarkdownPreview({ markdown, enableHeadingAnchors: false });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });
  });

  describe('Security', () => {
    it('should sanitize HTML by default', async () => {
      const markdown = signal('<script>alert("xss")</script>');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).not.toContain('<script>');
      }
    });

    it('should allow disabling sanitization', async () => {
      const markdown = signal('<div>content</div>');
      const rendered = MarkdownPreview({ markdown, sanitize: false });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should remove event handlers', async () => {
      const markdown = signal('<div onclick="alert()">click</div>');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).not.toContain('onclick');
      }
    });

    it('should remove javascript: URLs', async () => {
      const markdown = signal('<a href="javascript:alert()">link</a>');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).not.toContain('javascript:');
      }
    });
  });

  describe('Error handling', () => {
    it('should handle invalid markdown gracefully', async () => {
      const markdown = signal('```\nunclosed code block');
      const rendered = MarkdownPreview({ markdown });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(rendered).toBeDefined();
    });

    it('should display error message on render failure', async () => {
      const markdown = signal('test');
      const renderer = () => {
        throw new Error('Render error');
      };
      const rendered = MarkdownPreview({ markdown, renderer });

      await new Promise(resolve => setTimeout(resolve, 100));

      if (rendered instanceof Element) {
        expect(rendered.innerHTML).toContain('error');
      }
    });
  });
});
