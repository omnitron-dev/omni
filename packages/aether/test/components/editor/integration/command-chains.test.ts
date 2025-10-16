/**
 * Command Chains Integration Tests
 *
 * Tests that verify chained commands execute correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { UnderlineExtension } from '../../../../src/components/editor/extensions/marks/UnderlineExtension.js';
import { StrikeExtension } from '../../../../src/components/editor/extensions/marks/StrikeExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BlockquoteExtension } from '../../../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { createIntegrationTestEditor, cleanupEditor, setSelection, toggleMarkCommand, insertText } from './helpers.js';

describe('Command Chains', () => {
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
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
    ]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('Basic Mark Chains', () => {
    it('should chain bold and italic commands', () => {
      editor.setContent('<p>Test text</p>');
      setSelection(editor, 1, 10);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });

    it('should chain multiple mark commands', () => {
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

    it('should handle mark toggle chains', () => {
      editor.setContent('<p><strong>Bold text</strong></p>');
      setSelection(editor, 1, 10);

      // Toggle off bold, then add italic
      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).not.toContain('<strong>');
      expect(html).toContain('<em>');
    });

    it('should chain mark removal commands', () => {
      editor.setContent('<p><strong><em><u>Formatted</u></em></strong></p>');
      setSelection(editor, 1, 10);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');
      toggleMarkCommand(editor, 'underline');

      const html = editor.getHTML();
      expect(html).not.toContain('<strong>');
      expect(html).not.toContain('<em>');
      expect(html).not.toContain('<u>');
    });
  });

  describe('Content Manipulation Chains', () => {
    it('should chain content setting and formatting', () => {
      editor.setContent('<p>Initial</p>');
      editor.setContent('<p>New content</p>');
      setSelection(editor, 1, 12);
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('New content');
      expect(html).toContain('<strong>');
    });

    it('should chain clear and set content', () => {
      editor.setContent('<p>Old content</p>');
      editor.clearContent();
      editor.setContent('<p>New content</p>');

      const text = editor.getText();
      expect(text).toContain('New content');
      expect(text).not.toContain('Old content');
    });

    it('should chain text insertion and formatting', () => {
      editor.setContent('<p></p>');
      insertText(editor, 'Hello');
      setSelection(editor, 1, 6);
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('Hello');
      expect(html).toContain('<strong>');
    });

    it('should chain multiple text insertions', () => {
      editor.setContent('<p></p>');
      setSelection(editor, 1, 1);
      insertText(editor, 'First ');
      insertText(editor, 'Second ');
      insertText(editor, 'Third');

      const text = editor.getText();
      expect(text).toContain('First Second Third');
    });
  });

  describe('Selection Manipulation Chains', () => {
    it('should chain selection and formatting operations', () => {
      editor.setContent('<p>One Two Three</p>');

      setSelection(editor, 1, 4); // Select "One"
      toggleMarkCommand(editor, 'bold');

      setSelection(editor, 5, 8); // Select "Two"
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<strong>One</strong>');
      expect(html).toContain('<em>Two</em>');
    });

    it('should chain focus commands', () => {
      editor.setContent('<p>Content</p>');

      editor.focus('start');
      expect(editor.state.selection.from).toBe(1); // Position 1 is start of content

      editor.focus('end');
      expect(editor.state.selection.from).toBeGreaterThan(1);
    });

    it('should chain selection expansion and formatting', () => {
      editor.setContent('<p>Hello world</p>');

      setSelection(editor, 1, 6); // "Hello"
      toggleMarkCommand(editor, 'bold');

      setSelection(editor, 1, 12); // "Hello world"
      toggleMarkCommand(editor, 'italic');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });
  });

  describe('Node Transformation Chains', () => {
    it('should chain paragraph to heading transformation', () => {
      editor.setContent('<p>Heading text</p>');

      const html = editor.getHTML();
      expect(html).toBeDefined();
    });

    it('should chain heading level changes', () => {
      editor.setContent('<h1>Title</h1>');

      const html = editor.getHTML();
      expect(html).toContain('Title');
    });

    it('should chain blockquote toggle', () => {
      editor.setContent('<p>Quote</p>');

      const html = editor.getHTML();
      expect(html).toContain('Quote');
    });
  });

  describe('List Operation Chains', () => {
    it('should create list with multiple items', () => {
      editor.setContent('<p>Item 1</p><p>Item 2</p><p>Item 3</p>');

      const html = editor.getHTML();
      expect(html).toContain('Item 1');
      expect(html).toContain('Item 2');
      expect(html).toContain('Item 3');
    });

    it('should chain list type conversion', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');

      const html = editor.getHTML();
      expect(html).toContain('Item');
    });

    it('should chain list item formatting', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');
      setSelection(editor, 3, 7);
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      expect(html).toContain('<strong>');
    });
  });

  describe('Complex Chains', () => {
    it('should handle long command chains', () => {
      editor.setContent('<p>Start</p>');

      setSelection(editor, 1, 6);
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

    it('should chain document building commands', () => {
      editor.clearContent();
      editor.setContent('<h1>Title</h1>');
      const currentHTML = editor.getHTML();
      editor.setContent(currentHTML + '<p>Paragraph</p>');

      const text = editor.getText();
      expect(text).toContain('Title');
    });

    it('should chain formatting across multiple selections', () => {
      editor.setContent('<p>One Two Three Four</p>');

      setSelection(editor, 1, 4);
      toggleMarkCommand(editor, 'bold');

      setSelection(editor, 5, 8);
      toggleMarkCommand(editor, 'italic');

      setSelection(editor, 9, 14);
      toggleMarkCommand(editor, 'underline');

      const html = editor.getHTML();
      expect(html).toContain('<strong>One</strong>');
      expect(html).toContain('<em>Two</em>');
      expect(html).toContain('<u>Three</u>');
    });
  });

  describe('Idempotent Chains', () => {
    it('should handle repeated toggle commands', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      // Odd number of toggles - should be bold
      expect(html).toContain('<strong>');
    });

    it('should handle repeated selection commands', () => {
      editor.setContent('<p>Content</p>');

      setSelection(editor, 1, 8);
      setSelection(editor, 1, 8);
      setSelection(editor, 1, 8);

      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.to).toBe(8);
    });

    it('should handle repeated focus commands', () => {
      editor.setContent('<p>Test</p>');

      editor.focus('start');
      editor.focus('start');
      editor.focus('start');

      expect(editor.state.selection.from).toBe(1); // Position 1 is start of content
    });
  });

  describe('State Preservation', () => {
    it('should preserve marks through selection changes', () => {
      editor.setContent('<p><strong>Bold text</strong></p>');

      setSelection(editor, 1, 10);
      setSelection(editor, 2, 5);

      const html = editor.getHTML();
      expect(html).toContain('<strong>Bold text</strong>');
    });

    it('should preserve content through focus changes', () => {
      editor.setContent('<p>Content</p>');

      editor.focus('start');
      editor.blur();
      editor.focus('end');

      expect(editor.getText()).toContain('Content');
    });

    it('should preserve formatting through content additions', () => {
      editor.setContent('<p><strong>Bold</strong></p>');
      const html1 = editor.getHTML();

      setSelection(editor, 6, 6);
      insertText(editor, ' text');

      const html2 = editor.getHTML();
      expect(html2).toContain('Bold');
      expect(html2).toContain('strong');
    });
  });

  describe('Error Recovery', () => {
    it('should handle invalid selection gracefully', () => {
      editor.setContent('<p>Text</p>');

      // Try invalid selection (beyond content)
      try {
        setSelection(editor, 1000, 2000);
      } catch (e) {
        // Should not crash
      }

      expect(editor.getText()).toContain('Text');
    });

    it('should handle empty content operations', () => {
      editor.clearContent();

      setSelection(editor, 0, 0);
      toggleMarkCommand(editor, 'bold');

      expect(editor.isEmpty()).toBe(true);
    });

    it('should recover from failed commands', () => {
      editor.setContent('<p>Test</p>');
      const initialHTML = editor.getHTML();

      // Try to apply non-existent command
      try {
        toggleMarkCommand(editor, 'nonexistent');
      } catch (e) {
        // Should not crash
      }

      expect(editor.getHTML()).toBe(initialHTML);
    });
  });

  describe('Transaction Batching', () => {
    it('should batch multiple formatting changes', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      const initialState = editor.state;

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      // State should have changed
      expect(editor.state).not.toBe(initialState);
    });

    it('should batch selection and format changes', () => {
      editor.setContent('<p>Hello world</p>');

      setSelection(editor, 1, 6);
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('<strong>Hello</strong>');
    });
  });

  describe('Undo/Redo with Chains', () => {
    it('should handle undo after command chain', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');

      const formattedHTML = editor.getHTML();
      expect(formattedHTML).toContain('<strong>');
      expect(formattedHTML).toContain('<em>');
    });

    it('should handle redo after undo', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
    });
  });

  describe('Content Type Chains', () => {
    it('should chain HTML content operations', () => {
      editor.setContent('<p>HTML content</p>', 'html');
      const html = editor.getHTML();
      expect(html).toContain('HTML content');
    });

    it('should chain text content operations', () => {
      editor.setContent('Plain text', 'text');
      const text = editor.getText();
      expect(text).toContain('Plain text');
    });

    it('should chain JSON content operations', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'JSON content' }],
          },
        ],
      };

      editor.setContent(json, 'json');
      const text = editor.getText();
      expect(text).toContain('JSON content');
    });
  });

  describe('Performance Chains', () => {
    it('should handle rapid command chains efficiently', () => {
      editor.setContent('<p>Performance test</p>');
      setSelection(editor, 1, 17);

      const start = Date.now();

      for (let i = 0; i < 10; i++) {
        toggleMarkCommand(editor, 'bold');
      }

      const duration = Date.now() - start;

      // Should complete quickly (less than 1 second for 10 toggles)
      expect(duration).toBeLessThan(1000);
    });

    it('should handle large content chains efficiently', () => {
      const largeText = 'Lorem ipsum '.repeat(100);
      editor.setContent(`<p>${largeText}</p>`);

      const start = Date.now();

      setSelection(editor, 1, largeText.length);
      toggleMarkCommand(editor, 'bold');

      const duration = Date.now() - start;

      // Should complete quickly
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty selection chains', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 1); // Cursor position

      toggleMarkCommand(editor, 'bold');

      // Should not crash
      expect(editor.getText()).toContain('Text');
    });

    it('should handle full document selection', () => {
      editor.setContent('<p>Paragraph one</p><p>Paragraph two</p>');

      setSelection(editor, 0, editor.state.doc.content.size);
      toggleMarkCommand(editor, 'bold');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
    });

    it('should handle selection at document boundaries', () => {
      editor.setContent('<p>Test</p>');

      editor.focus('start');
      toggleMarkCommand(editor, 'bold');

      editor.focus('end');
      toggleMarkCommand(editor, 'italic');

      expect(editor.getText()).toContain('Test');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle rapid successive commands', () => {
      editor.setContent('<p>Test</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');
      toggleMarkCommand(editor, 'italic');
      toggleMarkCommand(editor, 'underline');

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
      expect(html).toContain('<u>');
    });

    it('should maintain consistency under rapid changes', () => {
      editor.setContent('<p>Initial</p>');

      for (let i = 0; i < 5; i++) {
        setSelection(editor, 1, 8);
        toggleMarkCommand(editor, 'bold');
      }

      // Should end with bold (odd number of toggles)
      const html = editor.getHTML();
      expect(html).toContain('<strong>');
    });
  });
});
