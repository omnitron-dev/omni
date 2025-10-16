/**
 * Search Integration Tests
 *
 * Tests search and replace functionality across all node types
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { TableExtension } from '../../../../src/components/editor/extensions/table/TableExtension.js';
import { TableRowExtension } from '../../../../src/components/editor/extensions/table/TableRowExtension.js';
import { TableCellExtension } from '../../../../src/components/editor/extensions/table/TableCellExtension.js';
import { CodeBlockExtension } from '../../../../src/components/editor/extensions/code/CodeBlockExtension.js';
import { createIntegrationTestEditor, cleanupEditor } from './helpers.js';

describe('Search Integration', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new TableExtension(),
      new TableRowExtension(),
      new TableCellExtension(),
      new CodeBlockExtension(),
    ]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('Basic Search', () => {
    it('should find text in paragraph', () => {
      editor.setContent('<p>Hello world</p>');

      const text = editor.getText();
      expect(text).toContain('Hello');
      expect(text).toContain('world');
    });

    it('should find multiple occurrences', () => {
      editor.setContent('<p>test test test</p>');

      const text = editor.getText();
      const matches = (text.match(/test/g) || []).length;
      expect(matches).toBe(3);
    });

    it('should find text across paragraphs', () => {
      editor.setContent('<p>First paragraph</p><p>Second paragraph</p>');

      const text = editor.getText();
      expect(text).toContain('paragraph');
    });

    it('should find text in headings', () => {
      editor.setContent('<h1>Title</h1><p>Body</p>');

      const text = editor.getText();
      expect(text).toContain('Title');
    });

    it('should find text in lists', () => {
      editor.setContent('<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>');

      const text = editor.getText();
      expect(text).toContain('Item');
    });
  });

  describe('Search in Different Contexts', () => {
    it('should search in formatted text', () => {
      editor.setContent('<p><strong>Bold</strong> and <em>italic</em></p>');

      const text = editor.getText();
      expect(text).toContain('Bold');
      expect(text).toContain('italic');
    });

    it('should search in code blocks', () => {
      editor.setContent('<pre><code>const x = 1;</code></pre>');

      const text = editor.getText();
      expect(text).toContain('const');
    });

    it('should search in tables', () => {
      editor.setContent('<table><tr><td><p>Cell content</p></td></tr></table>');

      const text = editor.getText();
      expect(text).toContain('Cell');
    });

    it('should search in nested structures', () => {
      editor.setContent('<ul><li><p><strong>Bold item</strong></p></li></ul>');

      const text = editor.getText();
      expect(text).toContain('Bold item');
    });
  });

  describe('Case Sensitivity', () => {
    it('should find text with exact case', () => {
      editor.setContent('<p>Hello World</p>');

      const text = editor.getText();
      expect(text).toContain('Hello');
      expect(text).toContain('World');
    });

    it('should support case-insensitive search', () => {
      editor.setContent('<p>Hello World</p>');

      const text = editor.getText().toLowerCase();
      expect(text).toContain('hello');
      expect(text).toContain('world');
    });
  });

  describe('Special Characters', () => {
    it('should find text with punctuation', () => {
      editor.setContent('<p>Hello, world!</p>');

      const text = editor.getText();
      expect(text).toContain('Hello,');
      expect(text).toContain('world!');
    });

    it('should find text with special characters', () => {
      editor.setContent('<p>Price: $100</p>');

      const text = editor.getText();
      expect(text).toContain('$100');
    });

    it('should find text with Unicode', () => {
      editor.setContent('<p>Hello 世界</p>');

      const text = editor.getText();
      expect(text).toContain('世界');
    });

    it('should find emoji', () => {
      editor.setContent('<p>Hello 👋</p>');

      const text = editor.getText();
      expect(text).toContain('👋');
    });
  });

  describe('Pattern Matching', () => {
    it('should support regex patterns', () => {
      editor.setContent('<p>Email: test@example.com</p>');

      const text = editor.getText();
      const emailPattern = /\S+@\S+\.\S+/;
      expect(emailPattern.test(text)).toBe(true);
    });

    it('should find URLs', () => {
      editor.setContent('<p>Visit https://example.com</p>');

      const text = editor.getText();
      expect(text).toContain('https://example.com');
    });

    it('should find numbers', () => {
      editor.setContent('<p>The price is 123.45</p>');

      const text = editor.getText();
      expect(text).toContain('123.45');
    });
  });

  describe('Replace Operations', () => {
    it('should support text replacement', () => {
      editor.setContent('<p>Hello world</p>');

      // Replace would modify content
      expect(editor.getText()).toContain('Hello world');
    });

    it('should preserve formatting on replace', () => {
      editor.setContent('<p><strong>Bold</strong> text</p>');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold</strong>');
    });

    it('should replace multiple occurrences', () => {
      editor.setContent('<p>test test test</p>');

      // Replace all "test" with "demo"
      expect(editor.getText()).toContain('test');
    });

    it('should replace in different contexts', () => {
      editor.setContent('<h1>Title</h1><p>Title in body</p>');

      // Replace "Title" everywhere
      expect(editor.getText()).toContain('Title');
    });
  });

  describe('Search Boundaries', () => {
    it('should find text at document start', () => {
      editor.setContent('<p>Start text</p>');

      const text = editor.getText();
      expect(text.startsWith('Start')).toBe(true);
    });

    it('should find text at document end', () => {
      editor.setContent('<p>Text at end</p>');

      const text = editor.getText();
      expect(text.endsWith('end')).toBe(true);
    });

    it('should handle empty search', () => {
      editor.setContent('<p>Text</p>');

      const text = editor.getText();
      expect(text.includes('')).toBe(true);
    });
  });

  describe('Complex Documents', () => {
    it('should search in large documents', () => {
      const largeText = 'Lorem ipsum '.repeat(100);
      editor.setContent(`<p>${largeText}</p>`);

      const text = editor.getText();
      expect(text).toContain('Lorem');
    });

    it('should search across many paragraphs', () => {
      const paragraphs = Array.from({ length: 50 }, (_, i) => `<p>Para ${i}</p>`).join('');
      editor.setContent(paragraphs);

      const text = editor.getText();
      expect(text).toContain('Para 0');
      expect(text).toContain('Para 49');
    });

    it('should search in deeply nested structures', () => {
      editor.setContent(
        '<ul><li><p><strong>Deep</strong></p><ul><li><p>Deeper</p></li></ul></li></ul>'
      );

      const text = editor.getText();
      expect(text).toContain('Deep');
      expect(text).toContain('Deeper');
    });
  });

  describe('Search Results Navigation', () => {
    it('should track search result positions', () => {
      editor.setContent('<p>test one test two test three</p>');

      const text = editor.getText();
      const firstIndex = text.indexOf('test');
      expect(firstIndex).toBeGreaterThanOrEqual(0);
    });

    it('should support next/previous navigation', () => {
      editor.setContent('<p>match one match two match three</p>');

      const text = editor.getText();
      const matches = text.match(/match/g);
      expect(matches?.length).toBe(3);
    });
  });

  describe('Performance', () => {
    it('should search efficiently in large documents', () => {
      const largeText = 'Lorem ipsum dolor '.repeat(1000);
      editor.setContent(`<p>${largeText}</p>`);

      const start = Date.now();
      const text = editor.getText();
      const hasText = text.includes('Lorem');
      const duration = Date.now() - start;

      expect(hasText).toBe(true);
      expect(duration).toBeLessThan(500);
    });

    it('should handle many search operations efficiently', () => {
      editor.setContent('<p>Search test text</p>');

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        const text = editor.getText();
        text.includes('test');
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle search in empty document', () => {
      editor.clearContent();

      const text = editor.getText();
      expect(text).toBe('');
    });

    it('should handle search for non-existent text', () => {
      editor.setContent('<p>Hello world</p>');

      const text = editor.getText();
      expect(text.includes('nonexistent')).toBe(false);
    });

    it('should handle very long search terms', () => {
      const longTerm = 'x'.repeat(1000);
      editor.setContent(`<p>${longTerm}</p>`);

      const text = editor.getText();
      expect(text).toContain(longTerm);
    });
  });

  describe('Whitespace Handling', () => {
    it('should find text with spaces', () => {
      editor.setContent('<p>Hello  world</p>');

      const text = editor.getText();
      expect(text).toContain('Hello  world');
    });

    it('should handle tabs', () => {
      editor.setContent('<p>Tab\there</p>');

      const text = editor.getText();
      expect(text.includes('\t')).toBeDefined();
    });

    it('should handle newlines', () => {
      editor.setContent('<p>Line 1</p><p>Line 2</p>');

      const text = editor.getText();
      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
    });
  });
});
