/**
 * Content Serialization Integration Tests
 *
 * Tests HTML/JSON/Markdown export and import roundtrips
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { CodeExtension } from '../../../../src/components/editor/extensions/marks/CodeExtension.js';
import { LinkExtension } from '../../../../src/components/editor/extensions/media/LinkExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BlockquoteExtension } from '../../../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { TableExtension } from '../../../../src/components/editor/extensions/table/TableExtension.js';
import { TableRowExtension } from '../../../../src/components/editor/extensions/table/TableRowExtension.js';
import { TableCellExtension } from '../../../../src/components/editor/extensions/table/TableCellExtension.js';
import { TableHeaderExtension } from '../../../../src/components/editor/extensions/table/TableHeaderExtension.js';
import { CodeBlockExtension } from '../../../../src/components/editor/extensions/code/CodeBlockExtension.js';
import { ImageExtension } from '../../../../src/components/editor/extensions/media/ImageExtension.js';
import { createIntegrationTestEditor, cleanupEditor } from './helpers.js';

describe('Content Serialization', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BlockquoteExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new CodeExtension(),
      new LinkExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new TableExtension(),
      new TableRowExtension(),
      new TableCellExtension(),
      new TableHeaderExtension(),
      new CodeBlockExtension(),
      new ImageExtension(),
    ]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('HTML Serialization', () => {
    it('should serialize plain text to HTML', () => {
      editor.setContent('Plain text', 'text');

      const html = editor.getHTML();
      expect(html).toContain('Plain text');
      expect(html).toContain('<p>');
    });

    it('should serialize formatted text to HTML', () => {
      editor.setContent('<p><strong>Bold</strong> and <em>italic</em></p>');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold</strong>');
      expect(html).toContain('<em>italic</em>');
    });

    it('should serialize headings to HTML', () => {
      editor.setContent('<h1>Heading 1</h1><h2>Heading 2</h2>');

      const html = editor.getHTML();
      expect(html).toContain('<h1>Heading 1</h1>');
      expect(html).toContain('<h2>Heading 2</h2>');
    });

    it('should serialize lists to HTML', () => {
      editor.setContent('<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
      expect(html).toContain('Item 1');
    });

    it('should serialize tables to HTML', () => {
      editor.setContent(
        '<table><tr><th><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></table>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<table>');
      expect(html).toContain('<th>');
      expect(html).toContain('<td>');
    });

    it('should serialize code blocks to HTML', () => {
      editor.setContent('<pre><code>const x = 1;</code></pre>');

      const html = editor.getHTML();
      expect(html).toContain('<pre>');
      expect(html).toMatch(/<code/); // Match opening code tag
      expect(html).toContain('const x = 1;');
    });

    it('should serialize images to HTML', () => {
      editor.setContent('<p><img src="test.jpg" alt="Test" /></p>');

      const html = editor.getHTML();
      expect(html).toContain('<img');
      expect(html).toContain('src="test.jpg"');
      expect(html).toContain('alt="Test"');
    });

    it('should serialize links to HTML', () => {
      editor.setContent('<p><a href="https://example.com">Link</a></p>');

      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('Link');
    });
  });

  describe('HTML Deserialization', () => {
    it('should parse plain text from HTML', () => {
      editor.setContent('<p>Hello world</p>', 'html');

      const text = editor.getText();
      expect(text).toContain('Hello world');
    });

    it('should parse formatted text from HTML', () => {
      editor.setContent('<p><strong>Bold</strong></p>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold</strong>');
    });

    it('should parse headings from HTML', () => {
      editor.setContent('<h1>Title</h1>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('<h1>Title</h1>');
    });

    it('should parse lists from HTML', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('Item');
    });

    it('should parse tables from HTML', () => {
      editor.setContent('<table><tr><td><p>Cell</p></td></tr></table>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('<table>');
      expect(html).toContain('Cell');
    });

    it('should parse code blocks from HTML', () => {
      editor.setContent('<pre><code>code</code></pre>', 'html');

      const html = editor.getHTML();
      expect(html).toMatch(/<code/); // Match opening code tag
      expect(html).toContain('code');
    });

    it('should parse images from HTML', () => {
      editor.setContent('<p><img src="test.jpg" /></p>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('<img');
      expect(html).toContain('src="test.jpg"');
    });

    it('should parse links from HTML', () => {
      editor.setContent('<p><a href="https://example.com">Link</a></p>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('href=');
    });
  });

  describe('HTML Roundtrip', () => {
    it('should roundtrip simple text', () => {
      const original = '<p>Hello world</p>';
      editor.setContent(original, 'html');

      const result = editor.getHTML();
      expect(result).toContain('Hello world');
    });

    it('should roundtrip formatted text', () => {
      const original = '<p><strong>Bold</strong> and <em>italic</em></p>';
      editor.setContent(original, 'html');

      const result = editor.getHTML();
      expect(result).toContain('<strong>Bold</strong>');
      expect(result).toContain('<em>italic</em>');
    });

    it('should roundtrip complex document', () => {
      const original =
        '<h1>Title</h1><p>Paragraph</p><ul><li><p>Item</p></li></ul>';
      editor.setContent(original, 'html');

      const result = editor.getHTML();
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('Paragraph');
      expect(result).toContain('<ul>');
    });

    it('should roundtrip nested structures', () => {
      const original = '<blockquote><p><strong>Bold quote</strong></p></blockquote>';
      editor.setContent(original, 'html');

      const result = editor.getHTML();
      expect(result).toContain('<blockquote>');
      expect(result).toContain('<strong>Bold quote</strong>');
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize to JSON', () => {
      editor.setContent('<p>Hello world</p>');

      const json = editor.getJSON();
      expect(json).toBeDefined();
      expect(json.type).toBe('doc');
      expect(json.content).toBeDefined();
    });

    it('should serialize formatted text to JSON', () => {
      editor.setContent('<p><strong>Bold</strong></p>');

      const json = editor.getJSON();
      expect(json.content).toBeDefined();
      expect(json.content![0].type).toBe('paragraph');
    });

    it('should include marks in JSON', () => {
      editor.setContent('<p><strong>Bold</strong></p>');

      const json = editor.getJSON();
      const paragraph = json.content![0];
      expect(paragraph.content).toBeDefined();
    });

    it('should serialize headings to JSON', () => {
      editor.setContent('<h1>Title</h1>');

      const json = editor.getJSON();
      expect(json.content![0].type).toBe('heading');
    });

    it('should serialize lists to JSON', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');

      const json = editor.getJSON();
      expect(json.content![0].type).toBe('bullet_list');
    });

    it('should serialize tables to JSON', () => {
      editor.setContent('<table><tr><td><p>Cell</p></td></tr></table>');

      const json = editor.getJSON();
      expect(json.content![0].type).toBe('table');
    });
  });

  describe('JSON Deserialization', () => {
    it('should parse from JSON', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      editor.setContent(json, 'json');

      const text = editor.getText();
      expect(text).toContain('Hello');
    });

    it('should parse formatted text from JSON', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Bold',
                marks: [{ type: 'bold' }],
              },
            ],
          },
        ],
      };

      editor.setContent(json, 'json');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold</strong>');
    });

    it('should parse headings from JSON', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Title' }],
          },
        ],
      };

      editor.setContent(json, 'json');

      const html = editor.getHTML();
      expect(html).toContain('<h1>Title</h1>');
    });
  });

  describe('JSON Roundtrip', () => {
    it('should roundtrip simple text', () => {
      editor.setContent('<p>Hello</p>');
      const json = editor.getJSON();

      editor.setContent(json, 'json');

      const text = editor.getText();
      expect(text).toContain('Hello');
    });

    it('should roundtrip formatted text', () => {
      editor.setContent('<p><strong>Bold</strong></p>');
      const json = editor.getJSON();

      editor.setContent(json, 'json');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold</strong>');
    });

    it('should roundtrip complex documents', () => {
      editor.setContent('<h1>Title</h1><p>Body</p>');
      const json = editor.getJSON();

      editor.setContent(json, 'json');

      const html = editor.getHTML();
      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('Body');
    });
  });

  describe('Text Serialization', () => {
    it('should serialize to plain text', () => {
      editor.setContent('<p>Hello world</p>');

      const text = editor.getText();
      expect(text).toBe('Hello world');
    });

    it('should strip formatting in text', () => {
      editor.setContent('<p><strong>Bold</strong> and <em>italic</em></p>');

      const text = editor.getText();
      expect(text).toBe('Bold and italic');
    });

    it('should handle multiple paragraphs', () => {
      editor.setContent('<p>First</p><p>Second</p>');

      const text = editor.getText();
      expect(text).toContain('First');
      expect(text).toContain('Second');
    });

    it('should handle headings in text', () => {
      editor.setContent('<h1>Title</h1><p>Body</p>');

      const text = editor.getText();
      expect(text).toContain('Title');
      expect(text).toContain('Body');
    });

    it('should handle lists in text', () => {
      editor.setContent('<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>');

      const text = editor.getText();
      expect(text).toContain('Item 1');
      expect(text).toContain('Item 2');
    });
  });

  describe('Special Characters', () => {
    it('should escape HTML entities', () => {
      editor.setContent('<p>&lt;test&gt;</p>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });

    it('should handle ampersands', () => {
      editor.setContent('<p>A &amp; B</p>', 'html');

      const html = editor.getHTML();
      expect(html).toContain('&amp;');
    });

    it('should handle quotes', () => {
      editor.setContent('<p>&quot;Quoted&quot;</p>', 'html');

      const text = editor.getText();
      expect(text).toContain('Quoted');
    });

    it('should handle apostrophes', () => {
      editor.setContent("<p>It's working</p>", 'html');

      const text = editor.getText();
      expect(text).toContain("It's");
    });

    it('should handle Unicode characters', () => {
      editor.setContent('<p>Hello 世界</p>', 'html');

      const text = editor.getText();
      expect(text).toContain('世界');
    });

    it('should handle emoji', () => {
      editor.setContent('<p>Hello 👋</p>', 'html');

      const text = editor.getText();
      expect(text).toContain('👋');
    });
  });

  describe('Whitespace Handling', () => {
    it('should preserve single spaces', () => {
      editor.setContent('<p>Hello world</p>');

      const text = editor.getText();
      expect(text).toBe('Hello world');
    });

    it('should handle multiple spaces', () => {
      editor.setContent('<p>Hello  world</p>');

      const html = editor.getHTML();
      // ProseMirror normalizes whitespace (standard HTML behavior)
      expect(html).toContain('Hello world');
    });

    it('should handle leading spaces', () => {
      editor.setContent('<p> Leading</p>');

      const text = editor.getText();
      expect(text).toContain('Leading');
    });

    it('should handle trailing spaces', () => {
      editor.setContent('<p>Trailing </p>');

      const text = editor.getText();
      expect(text).toContain('Trailing');
    });

    it('should handle newlines in text', () => {
      editor.setContent('<p>Line 1</p><p>Line 2</p>');

      const text = editor.getText();
      expect(text).toContain('Line 1');
      expect(text).toContain('Line 2');
    });
  });

  describe('Empty Content', () => {
    it('should serialize empty document', () => {
      editor.clearContent();

      const html = editor.getHTML();
      expect(html).toBeDefined();
    });

    it('should serialize empty paragraph', () => {
      editor.setContent('<p></p>');

      const html = editor.getHTML();
      expect(html).toContain('<p>');
    });

    it('should serialize to empty text', () => {
      editor.clearContent();

      const text = editor.getText();
      expect(text).toBe('');
    });

    it('should serialize to empty JSON', () => {
      editor.clearContent();

      const json = editor.getJSON();
      expect(json).toBeDefined();
      expect(json.type).toBe('doc');
    });
  });

  describe('Large Documents', () => {
    it('should handle large text content', () => {
      const largeText = 'Lorem ipsum '.repeat(1000);
      editor.setContent(`<p>${largeText}</p>`);

      const html = editor.getHTML();
      expect(html).toContain('Lorem ipsum');
    });

    it('should handle many paragraphs', () => {
      const paragraphs = Array.from({ length: 100 }, (_, i) => `<p>Para ${i}</p>`).join('');
      editor.setContent(paragraphs);

      const text = editor.getText();
      expect(text).toContain('Para 0');
      expect(text).toContain('Para 99');
    });

    it('should handle deep nesting', () => {
      const nested = '<blockquote><blockquote><blockquote><p>Deep</p></blockquote></blockquote></blockquote>';
      editor.setContent(nested);

      const text = editor.getText();
      expect(text).toContain('Deep');
    });
  });

  describe('Content Type Detection', () => {
    it('should auto-detect HTML content', () => {
      editor.setContent('<p>HTML</p>');

      const text = editor.getText();
      expect(text).toContain('HTML');
    });

    it('should handle plain text input', () => {
      editor.setContent('Plain text', 'text');

      const text = editor.getText();
      expect(text).toContain('Plain text');
    });

    it('should handle JSON input', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'JSON' }],
          },
        ],
      };

      editor.setContent(json, 'json');

      const text = editor.getText();
      expect(text).toContain('JSON');
    });
  });

  describe('Attribute Preservation', () => {
    it('should preserve link attributes', () => {
      editor.setContent('<p><a href="https://example.com" title="Example">Link</a></p>');

      const html = editor.getHTML();
      expect(html).toContain('href="https://example.com"');
    });

    it('should preserve image attributes', () => {
      editor.setContent('<p><img src="test.jpg" alt="Test" width="100" /></p>');

      const html = editor.getHTML();
      expect(html).toContain('src="test.jpg"');
      expect(html).toContain('alt="Test"');
    });

    it('should preserve heading levels', () => {
      editor.setContent('<h1>H1</h1><h2>H2</h2><h3>H3</h3>');

      const html = editor.getHTML();
      expect(html).toContain('<h1>H1</h1>');
      expect(html).toContain('<h2>H2</h2>');
      expect(html).toContain('<h3>H3</h3>');
    });

    it('should preserve list types', () => {
      editor.setContent('<ul><li><p>Bullet</p></li></ul><ol><li><p>Numbered</p></li></ol>');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('<ol>');
    });
  });
});
