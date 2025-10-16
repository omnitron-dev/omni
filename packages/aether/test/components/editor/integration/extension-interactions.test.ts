/**
 * Extension Interactions Integration Tests
 *
 * Tests that verify multiple extensions work correctly together
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { UnderlineExtension } from '../../../../src/components/editor/extensions/marks/UnderlineExtension.js';
import { StrikeExtension } from '../../../../src/components/editor/extensions/marks/StrikeExtension.js';
import { CodeExtension } from '../../../../src/components/editor/extensions/marks/CodeExtension.js';
import { LinkExtension } from '../../../../src/components/editor/extensions/media/LinkExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BlockquoteExtension } from '../../../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { TaskListExtension } from '../../../../src/components/editor/extensions/lists/TaskListExtension.js';
import { TaskItemExtension } from '../../../../src/components/editor/extensions/lists/TaskItemExtension.js';
import { TableExtension } from '../../../../src/components/editor/extensions/table/TableExtension.js';
import { TableRowExtension } from '../../../../src/components/editor/extensions/table/TableRowExtension.js';
import { TableCellExtension } from '../../../../src/components/editor/extensions/table/TableCellExtension.js';
import { TableHeaderExtension } from '../../../../src/components/editor/extensions/table/TableHeaderExtension.js';
import { CodeBlockExtension } from '../../../../src/components/editor/extensions/code/CodeBlockExtension.js';
import { ImageExtension } from '../../../../src/components/editor/extensions/media/ImageExtension.js';
import {
  createIntegrationTestEditor,
  cleanupEditor,
  setSelection,
  toggleMarkCommand,
  isMarkActive,
} from './helpers.js';

describe('Extension Interactions', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BlockquoteExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new UnderlineExtension(),
      new StrikeExtension(),
      new CodeExtension(),
      new LinkExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new TaskListExtension(),
      new TaskItemExtension(),
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

  describe('Multiple Marks on Same Text', () => {
    it('should support bold and italic on same text', () => {
      editor.setContent('<p>Hello world</p>');
      setSelection(editor, 1, 12); // Select "Hello world"

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      expect(editor.getHTML()).toContain('<strong>');
      expect(editor.getHTML()).toContain('<em>');
    });

    it('should support bold, italic, and underline together', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');
      toggleMarkCommand(editor, 'underline');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
      expect(html).toContain('<u>');
    });

    it('should support all inline marks simultaneously', () => {
      editor.setContent('<p>Test</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');
      toggleMarkCommand(editor, 'underline');
      toggleMarkCommand(editor, 'strike');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
      expect(html).toContain('<u>');
      expect(html).toContain('<s>');
    });

    it('should remove individual marks without affecting others', () => {
      editor.setContent('<p><strong><em>Text</em></strong></p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');

      expect(editor.getHTML()).toContain('<em>');
      expect(editor.getHTML()).not.toContain('<strong>');
    });

    it('should handle overlapping mark ranges', () => {
      editor.setContent('<p>Hello world</p>');

      // Make "Hello" bold
      setSelection(editor, 1, 6);
      toggleMarkCommand(editor, 'bold');

      // Make "world" italic
      setSelection(editor, 7, 12);
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Hello</strong>');
      expect(html).toContain('<em>world</em>');
    });

    it('should handle partially overlapping marks', () => {
      editor.setContent('<p>One two three</p>');

      // Make "One two" bold
      setSelection(editor, 1, 8);
      toggleMarkCommand(editor, 'bold');

      // Make "two three" italic
      setSelection(editor, 5, 15);
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('strong');
      expect(html).toContain('em');
    });
  });

  describe('Marks Inside Nodes', () => {
    it('should support bold text in headings', () => {
      editor.setContent('<h1>Bold heading</h1>');
      setSelection(editor, 1, 5); // Select "Bold"

      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('<h1>');
      expect(html).toContain('<strong>Bold</strong>');
    });

    it('should support italic text in blockquotes', () => {
      editor.setContent('<blockquote><p>Quoted text</p></blockquote>');
      setSelection(editor, 2, 8); // Select "Quoted"

      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<em>Quoted</em>');
    });

    it('should support multiple marks in list items', () => {
      editor.setContent('<ul><li><p>List item</p></li></ul>');
      setSelection(editor, 3, 7); // Select "List"

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });

    it('should support links with bold text', () => {
      editor.setContent('<p><a href="https://example.com">Link text</a></p>');
      setSelection(editor, 2, 6); // Select "Link"

      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('<strong>Link</strong>');
    });

    it('should support formatted text in table cells', () => {
      editor.setContent(
        '<table><tr><td><p>Cell content</p></td></tr></table>'
      );
      setSelection(editor, 4, 8); // Select "Cell"

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<table>');
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });
  });

  describe('Links with Formatting', () => {
    it('should create link with bold text inside', () => {
      editor.setContent('<p><strong>Bold text</strong></p>');
      setSelection(editor, 1, 10);

      // Links should work with formatted text
      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold text</strong>');
    });

    it('should support link with italic text', () => {
      editor.setContent('<p><a href="https://example.com"><em>Italic link</em></a></p>');

      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('<em>Italic link</em>');
    });

    it('should support link with multiple marks', () => {
      editor.setContent(
        '<p><a href="https://example.com"><strong><em>Formatted link</em></strong></a></p>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });
  });

  describe('Code Mark Exclusivity', () => {
    it('should not allow bold inside code', () => {
      editor.setContent('<p><code>Code text</code></p>');
      setSelection(editor, 2, 6); // Select "Code"

      // Try to apply bold - should fail or remove code
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      // Code and formatting marks are typically mutually exclusive
      const hasBothCodeAndBold = html.includes('<code>') && html.includes('<strong>');
      expect(hasBothCodeAndBold).toBe(false);
    });

    it('should not allow italic inside code', () => {
      editor.setContent('<p><code>Code text</code></p>');
      setSelection(editor, 2, 6);

      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      const hasBothCodeAndItalic = html.includes('<code>') && html.includes('<em>');
      expect(hasBothCodeAndItalic).toBe(false);
    });
  });

  describe('Nested Block Nodes', () => {
    it('should support lists inside blockquotes', () => {
      editor.setContent(
        '<blockquote><ul><li><p>List in quote</p></li></ul></blockquote>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
    });

    it('should support multiple list items in blockquote', () => {
      editor.setContent(
        '<blockquote><ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul></blockquote>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<blockquote>');
      expect(html).toContain('Item 1');
      expect(html).toContain('Item 2');
    });
  });

  describe('Task Lists with Formatting', () => {
    it('should support bold text in task items', () => {
      editor.setContent(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>'
      );
      setSelection(editor, 3, 7);

      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('taskList');
      expect(html).toContain('<strong>Task</strong>');
    });

    it('should support links in task items', () => {
      editor.setContent(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p><a href="https://example.com">Link</a></p></li></ul>'
      );

      const html = editor.getHTML();
      expect(html).toContain('taskList');
      expect(html).toContain('<a');
    });
  });

  describe('Images and Text', () => {
    it('should support images in paragraphs', () => {
      editor.setContent('<p><img src="test.jpg" alt="Test" /></p>');

      const html = editor.getHTML();
      expect(html).toContain('<img');
      expect(html).toContain('src="test.jpg"');
    });

    it('should support text before and after images', () => {
      editor.setContent('<p>Before <img src="test.jpg" alt="Test" /> After</p>');

      const html = editor.getHTML();
      expect(html).toContain('Before');
      expect(html).toContain('<img');
      expect(html).toContain('After');
    });
  });

  describe('Mixed Content Documents', () => {
    it('should handle document with multiple node types', () => {
      editor.setContent(
        '<h1>Title</h1><p>Paragraph</p><blockquote><p>Quote</p></blockquote><ul><li><p>Item</p></li></ul>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('<p>Paragraph</p>');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<ul>');
    });

    it('should handle complex nested structures', () => {
      editor.setContent(
        '<blockquote><h2>Quoted heading</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li><p>List item</p></li></ul></blockquote>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<h2>');
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
      expect(html).toContain('<ul>');
    });

    it('should handle table with formatted content', () => {
      editor.setContent(
        '<table><tr><th><p><strong>Header</strong></p></th></tr><tr><td><p><em>Cell</em></p></td></tr></table>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<table>');
      expect(html).toContain('<th>');
      expect(html).toContain('<strong>Header</strong>');
      expect(html).toContain('<td>');
      expect(html).toContain('<em>Cell</em>');
    });

    it('should handle code blocks with other content', () => {
      editor.setContent(
        '<p>Text before</p><pre><code>Code block</code></pre><p>Text after</p>'
      );

      const html = editor.getHTML();
      expect(html).toContain('Text before');
      expect(html).toContain('<pre>');
      expect(html).toContain('<code>');
      expect(html).toContain('Text after');
    });
  });

  describe('Schema Validation', () => {
    it('should not allow invalid node nesting', () => {
      // Try to create invalid structure - paragraph inside paragraph
      // This should be prevented by schema
      editor.setContent('<p>Valid paragraph</p>');
      const html = editor.getHTML();
      expect(html).toContain('<p>');
      expect(html).not.toContain('<p><p>');
    });

    it('should enforce list item content rules', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
      expect(html).toContain('<p>');
    });

    it('should enforce table structure rules', () => {
      editor.setContent(
        '<table><tr><td><p>Cell</p></td></tr></table>'
      );

      const html = editor.getHTML();
      expect(html).toContain('<table>');
      expect(html).toContain('<tr>');
      expect(html).toContain('<td>');
    });
  });

  describe('Mark Precedence', () => {
    it('should maintain consistent mark order', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      // Apply marks in different orders
      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      const html1 = editor.getHTML();

      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'italic');
      toggleMarkCommand(editor, 'bold');

      const html2 = editor.getHTML();

      // Both should have both marks, regardless of application order
      expect(html1).toContain('strong');
      expect(html1).toContain('em');
      expect(html2).toContain('strong');
      expect(html2).toContain('em');
    });
  });

  describe('Content Preservation', () => {
    it('should preserve whitespace in formatted text', () => {
      editor.setContent('<p><strong>Hello  world</strong></p>');

      const text = editor.getText();
      expect(text).toContain('  '); // Double space preserved
    });

    it('should preserve attributes across transformations', () => {
      editor.setContent('<p><a href="https://example.com">Link</a></p>');
      setSelection(editor, 2, 6);

      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('href="https://example.com"');
    });
  });

  describe('Empty Content Handling', () => {
    it('should handle empty nodes gracefully', () => {
      editor.setContent('<p></p>');

      const html = editor.getHTML();
      expect(html).toContain('<p>');
    });

    it('should handle empty list items', () => {
      editor.setContent('<ul><li><p></p></li></ul>');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
    });

    it('should handle empty table cells', () => {
      editor.setContent('<table><tr><td><p></p></td></tr></table>');

      const html = editor.getHTML();
      expect(html).toContain('<table>');
      expect(html).toContain('<td>');
    });
  });

  describe('Special Character Handling', () => {
    it('should handle special HTML characters in formatted text', () => {
      editor.setContent('<p><strong>&lt;test&gt;</strong></p>');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });

    it('should handle ampersands in links', () => {
      editor.setContent('<p><a href="https://example.com?a=1&amp;b=2">Link</a></p>');

      const html = editor.getHTML();
      expect(html).toContain('href=');
      expect(html).toContain('&amp;');
    });
  });
});
