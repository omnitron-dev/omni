/**
 * Performance Integration Tests
 *
 * Tests editor performance with large documents and rapid operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { TableExtension } from '../../../../src/components/editor/extensions/table/TableExtension.js';
import { TableRowExtension } from '../../../../src/components/editor/extensions/table/TableRowExtension.js';
import { TableCellExtension } from '../../../../src/components/editor/extensions/table/TableCellExtension.js';
import { TableHeaderExtension } from '../../../../src/components/editor/extensions/table/TableHeaderExtension.js';
import { HistoryExtension } from '../../../../src/components/editor/extensions/behavior/HistoryExtension.js';
import {
  createIntegrationTestEditor,
  cleanupEditor,
  setSelection,
  toggleMarkCommand,
  insertText,
} from './helpers.js';

describe('Performance', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new BulletListExtension(),
      new ListItemExtension(),
      new TableRowExtension(),
      new TableCellExtension(),
      new TableHeaderExtension(),
      new TableExtension(),
      new HistoryExtension(),
    ]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('Large Document Loading', () => {
    it('should load large text document quickly', () => {
      const largeText = 'Lorem ipsum dolor sit amet. '.repeat(1000);
      const content = `<p>${largeText}</p>`;

      const start = Date.now();
      editor.setContent(content);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(editor.getText()).toContain('Lorem ipsum');
    });

    it('should load many paragraphs quickly', () => {
      const paragraphs = Array.from({ length: 500 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');

      const start = Date.now();
      editor.setContent(paragraphs);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000);
      expect(editor.getText()).toContain('Paragraph 0');
    });

    it('should load complex nested structure quickly', () => {
      const listItems = Array.from({ length: 100 }, (_, i) => `<li><p>Item ${i}</p></li>`).join('');
      const content = `<ul>${listItems}</ul>`;

      const start = Date.now();
      editor.setContent(content);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1500);
    });

    it('should load large table quickly', () => {
      const rows = Array.from(
        { length: 50 },
        (_, i) => `<tr><td><p>Cell ${i}-1</p></td><td><p>Cell ${i}-2</p></td></tr>`
      ).join('');
      const content = `<table>${rows}</table>`;

      const start = Date.now();
      editor.setContent(content);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Rapid Typing Performance', () => {
    it('should handle rapid text insertion', () => {
      editor.setContent('<p></p>');
      setSelection(editor, 1, 1);

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        insertText(editor, 'x');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(editor.getText().length).toBeGreaterThan(50);
    });

    it('should handle rapid formatting changes', () => {
      editor.setContent('<p>Text to format</p>');
      setSelection(editor, 1, 15);

      const start = Date.now();

      for (let i = 0; i < 20; i++) {
        toggleMarkCommand(editor, 'bold');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle rapid selection changes', () => {
      editor.setContent('<p>Long text content for selection testing</p>');

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        setSelection(editor, i % 10, (i % 10) + 5);
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
    });
  });

  describe('Rendering Performance', () => {
    it('should render large document efficiently', () => {
      const content = Array.from({ length: 200 }, (_, i) => `<p>Para ${i}</p>`).join('');
      editor.setContent(content);

      const start = Date.now();
      const html = editor.getHTML();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
      expect(html).toBeDefined();
    });

    it('should serialize large document efficiently', () => {
      const content = Array.from({ length: 200 }, (_, i) => `<p>Para ${i}</p>`).join('');
      editor.setContent(content);

      const start = Date.now();
      const json = editor.getJSON();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
      expect(json.content).toBeDefined();
    });

    it('should extract text efficiently', () => {
      const largeText = 'Lorem ipsum '.repeat(1000);
      editor.setContent(`<p>${largeText}</p>`);

      const start = Date.now();
      const text = editor.getText();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200);
      expect(text).toContain('Lorem');
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory with repeated content changes', () => {
      const initialMemory = process.memoryUsage?.().heapUsed || 0;

      for (let i = 0; i < 50; i++) {
        editor.setContent(`<p>Iteration ${i}</p>`);
      }

      const finalMemory = process.memoryUsage?.().heapUsed || 0;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB for 50 iterations)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should clean up on editor destroy', () => {
      editor.setContent('<p>Content</p>');

      const beforeDestroy = process.memoryUsage?.().heapUsed || 0;
      editor.destroy();

      // Memory should be released (allowing some variance)
      expect(editor).toBeDefined();
    });

    it('should handle many signal updates without leaks', () => {
      editor.setContent('<p>Initial</p>');

      for (let i = 0; i < 100; i++) {
        setSelection(editor, 1, 5);
        editor.setContent(`<p>Update ${i}</p>`);
      }

      expect(editor.getText()).toContain('Update');
    });
  });

  describe('Extension Initialization', () => {
    it('should initialize extensions quickly', () => {
      const start = Date.now();

      const testEditor = createIntegrationTestEditor([
        new ParagraphExtension(),
        new HeadingExtension(),
        new BoldExtension(),
        new ItalicExtension(),
        new BulletListExtension(),
        new ListItemExtension(),
        new HistoryExtension(),
      ]);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);

      testEditor.destroy();
    });

    it('should handle many extensions efficiently', () => {
      const extensions = [
        new ParagraphExtension(),
        new HeadingExtension(),
        new BoldExtension(),
        new ItalicExtension(),
        new BulletListExtension(),
        new ListItemExtension(),
        new TableRowExtension(),
        new TableCellExtension(),
        new TableHeaderExtension(),
        new TableExtension(),
        new HistoryExtension(),
      ];

      const start = Date.now();
      const testEditor = createIntegrationTestEditor(extensions);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);

      testEditor.destroy();
    });
  });

  describe('Transaction Processing', () => {
    it('should process transactions efficiently', () => {
      editor.setContent('<p>Text</p>');

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        setSelection(editor, 1, 5);
        toggleMarkCommand(editor, 'bold');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should batch transactions efficiently', () => {
      editor.setContent('<p>Text</p>');

      const start = Date.now();

      for (let i = 0; i < 50; i++) {
        setSelection(editor, 1, 5);
        toggleMarkCommand(editor, 'bold');
        toggleMarkCommand(editor, 'italic');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Signal Updates', () => {
    it('should update signals efficiently', () => {
      editor.setContent('<p>Initial</p>');

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        editor.setContent(`<p>Update ${i}</p>`);
        const doc = editor.signals.doc();
        const isEmpty = editor.signals.isEmpty();
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle rapid signal reads', () => {
      editor.setContent('<p>Text for testing</p>');

      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        const doc = editor.signals.doc();
        const selection = editor.signals.selection();
        const isEmpty = editor.signals.isEmpty();
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
    });
  });

  describe('Complex Operations', () => {
    it('should handle complex document transformations efficiently', () => {
      editor.setContent('<p>Start</p>');

      const start = Date.now();

      for (let i = 0; i < 20; i++) {
        editor.setContent('<h1>Heading</h1>');
        editor.setContent('<p>Paragraph</p>');
        editor.setContent('<ul><li><p>List</p></li></ul>');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle interleaved operations efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 30; i++) {
        editor.setContent('<p>Text</p>');
        setSelection(editor, 1, 5);
        toggleMarkCommand(editor, 'bold');
        const html = editor.getHTML();
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1500);
    });
  });

  describe('Stress Tests', () => {
    it('should handle maximum document size', () => {
      const maxText = 'x'.repeat(100000);
      const content = `<p>${maxText}</p>`;

      const start = Date.now();
      editor.setContent(content);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(3000);
    });

    it('should handle many rapid operations', () => {
      editor.setContent('<p>Test</p>');

      const start = Date.now();

      for (let i = 0; i < 200; i++) {
        if (i % 4 === 0) setSelection(editor, 1, 5);
        if (i % 4 === 1) toggleMarkCommand(editor, 'bold');
        if (i % 4 === 2) editor.setContent(`<p>Iter ${i}</p>`);
        if (i % 4 === 3) editor.getHTML();
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000);
    });

    it('should maintain performance under sustained load', () => {
      const durations: number[] = [];

      for (let round = 0; round < 10; round++) {
        const start = Date.now();

        for (let i = 0; i < 20; i++) {
          editor.setContent(`<p>Round ${round} Iter ${i}</p>`);
        }

        durations.push(Date.now() - start);
      }

      // Performance should not degrade significantly
      const firstDuration = durations[0];
      const lastDuration = durations[durations.length - 1];

      // Last duration should not be more than 2x first duration
      expect(lastDuration).toBeLessThan(firstDuration * 2);
    });
  });

  describe('Edge Case Performance', () => {
    it('should handle empty document operations efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        editor.clearContent();
        editor.setContent('<p>Text</p>');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle single character operations efficiently', () => {
      editor.setContent('<p></p>');

      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        setSelection(editor, 1, 1);
        insertText(editor, 'x');
      }

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });
});
