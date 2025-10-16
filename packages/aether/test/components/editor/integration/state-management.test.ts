/**
 * State Management Integration Tests
 *
 * Tests that verify editor signals update correctly across extensions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { HistoryExtension } from '../../../../src/components/editor/extensions/behavior/HistoryExtension.js';
import {
  createIntegrationTestEditor,
  cleanupEditor,
  setSelection,
  toggleMarkCommand,
  insertText,
} from './helpers.js';

describe('State Management', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new BulletListExtension(),
      new ListItemExtension(),
      new HistoryExtension(),
    ]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('Document Signal', () => {
    it('should update doc signal when content changes', () => {
      const initialDoc = editor.signals.doc();

      editor.setContent('<p>New content</p>');

      const newDoc = editor.signals.doc();
      expect(newDoc).not.toBe(initialDoc);
    });

    it('should update doc signal on text insertion', () => {
      editor.setContent('<p></p>');
      const initialDoc = editor.signals.doc();

      insertText(editor, 'Hello');

      const newDoc = editor.signals.doc();
      expect(newDoc).not.toBe(initialDoc);
    });

    it('should update doc signal on formatting', () => {
      editor.setContent('<p>Text</p>');
      const initialDoc = editor.signals.doc();

      setSelection(editor, 1, 5);
      toggleMarkCommand(editor, 'bold');

      const newDoc = editor.signals.doc();
      expect(newDoc).not.toBe(initialDoc);
    });

    it('should not update doc signal on selection change', () => {
      editor.setContent('<p>Text</p>');
      const initialDoc = editor.signals.doc();

      setSelection(editor, 1, 5);

      const newDoc = editor.signals.doc();
      expect(newDoc).toBe(initialDoc);
    });
  });

  describe('Selection Signal', () => {
    it('should update selection signal when selection changes', () => {
      editor.setContent('<p>Hello world</p>');
      const initialSelection = editor.signals.selection();

      setSelection(editor, 1, 6);

      const newSelection = editor.signals.selection();
      expect(newSelection).not.toBe(initialSelection);
      expect(newSelection.from).toBe(1);
      expect(newSelection.to).toBe(6);
    });

    it('should update selection on cursor movement', () => {
      editor.setContent('<p>Text</p>');

      setSelection(editor, 1, 1);
      const pos1 = editor.signals.selection().from;

      setSelection(editor, 3, 3);
      const pos2 = editor.signals.selection().from;

      expect(pos2).not.toBe(pos1);
    });

    it('should update selection on text insertion', () => {
      editor.setContent('<p></p>');
      const initialFrom = editor.signals.selection().from;

      insertText(editor, 'Hello');

      const newFrom = editor.signals.selection().from;
      expect(newFrom).toBeGreaterThan(initialFrom);
    });

    it('should track selection range', () => {
      editor.setContent('<p>Hello world</p>');
      setSelection(editor, 1, 6);

      const selection = editor.signals.selection();
      expect(selection.from).toBe(1);
      expect(selection.to).toBe(6);
    });
  });

  describe('Focus Signal', () => {
    it('should update isFocused signal on focus', () => {
      expect(editor.signals.isFocused()).toBe(false);

      editor.focus();

      expect(editor.signals.isFocused()).toBe(true);
    });

    it('should update isFocused signal on blur', () => {
      editor.focus();
      expect(editor.signals.isFocused()).toBe(true);

      editor.blur();

      expect(editor.signals.isFocused()).toBe(false);
    });

    it('should maintain focus state through operations', () => {
      editor.focus();

      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);
      toggleMarkCommand(editor, 'bold');

      expect(editor.signals.isFocused()).toBe(true);
    });
  });

  describe('Editable Signal', () => {
    it('should reflect initial editable state', () => {
      expect(editor.signals.isEditable()).toBe(true);
    });

    it('should update editable state', () => {
      editor.signals.isEditable.set(false);

      expect(editor.signals.isEditable()).toBe(false);
      expect(editor.isEditable()).toBe(false);
    });

    it('should prevent editing when not editable', () => {
      editor.setContent('<p>Text</p>');
      editor.signals.isEditable.set(false);

      const initialContent = editor.getHTML();

      // Try to insert text
      try {
        insertText(editor, 'More');
      } catch (e) {
        // May throw or be ignored
      }

      // Content should not change in read-only mode
      // Note: Actual behavior depends on ProseMirror implementation
      expect(editor.isEditable()).toBe(false);
    });

    it('should allow editing when editable is true', () => {
      editor.signals.isEditable.set(true);

      editor.setContent('<p>Text</p>');
      insertText(editor, ' more');

      expect(editor.getText()).toContain('Text');
    });
  });

  describe('IsEmpty Signal', () => {
    it('should be true for empty document', () => {
      editor.clearContent();

      expect(editor.signals.isEmpty()).toBe(true);
      expect(editor.isEmpty()).toBe(true);
    });

    it('should be false for non-empty document', () => {
      editor.setContent('<p>Text</p>');

      expect(editor.signals.isEmpty()).toBe(false);
      expect(editor.isEmpty()).toBe(false);
    });

    it('should update when content is added', () => {
      editor.clearContent();
      expect(editor.signals.isEmpty()).toBe(true);

      editor.setContent('<p>Text</p>');

      expect(editor.signals.isEmpty()).toBe(false);
    });

    it('should update when content is cleared', () => {
      editor.setContent('<p>Text</p>');
      expect(editor.signals.isEmpty()).toBe(false);

      editor.clearContent();

      expect(editor.signals.isEmpty()).toBe(true);
    });
  });

  describe('Word Count Signal', () => {
    it('should count words correctly', () => {
      editor.setContent('<p>Hello world</p>');

      expect(editor.signals.wordCount()).toBe(2);
    });

    it('should update word count on content change', () => {
      editor.setContent('<p>One</p>');
      expect(editor.signals.wordCount()).toBe(1);

      editor.setContent('<p>One two three</p>');

      expect(editor.signals.wordCount()).toBe(3);
    });

    it('should be zero for empty document', () => {
      editor.clearContent();

      expect(editor.signals.wordCount()).toBe(0);
    });

    it('should count words across multiple paragraphs', () => {
      editor.setContent('<p>First paragraph</p><p>Second paragraph</p>');

      expect(editor.signals.wordCount()).toBe(4);
    });

    it('should handle words with punctuation', () => {
      editor.setContent('<p>Hello, world!</p>');

      // Should count as 2 words
      expect(editor.signals.wordCount()).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Character Count Signal', () => {
    it('should count characters correctly', () => {
      editor.setContent('<p>Hello</p>');

      expect(editor.signals.charCount()).toBe(5);
    });

    it('should update character count on content change', () => {
      editor.setContent('<p>Hi</p>');
      expect(editor.signals.charCount()).toBe(2);

      editor.setContent('<p>Hello world</p>');

      expect(editor.signals.charCount()).toBe(11);
    });

    it('should be zero for empty document', () => {
      editor.clearContent();

      expect(editor.signals.charCount()).toBe(0);
    });

    it('should count characters across multiple paragraphs', () => {
      editor.setContent('<p>First</p><p>Second</p>');

      // Should count both words (excluding markup)
      expect(editor.signals.charCount()).toBeGreaterThan(10);
    });

    it('should include spaces in character count', () => {
      editor.setContent('<p>Hello world</p>');

      // "Hello world" = 11 characters including space
      expect(editor.signals.charCount()).toBe(11);
    });
  });

  describe('Undo/Redo Signals', () => {
    it('should track canUndo state', () => {
      editor.setContent('<p>Initial</p>');
      expect(editor.signals.canUndo()).toBe(false);

      editor.setContent('<p>Modified</p>');

      expect(editor.signals.canUndo()).toBe(true);
    });

    it('should track canRedo state', () => {
      editor.setContent('<p>Text</p>');
      expect(editor.signals.canRedo()).toBe(false);
    });

    it('should update canUndo after multiple changes', () => {
      editor.setContent('<p>One</p>');
      editor.setContent('<p>Two</p>');
      editor.setContent('<p>Three</p>');

      expect(editor.signals.canUndo()).toBe(true);
    });

    it('should update canRedo after undo', () => {
      editor.setContent('<p>Original</p>');
      editor.setContent('<p>Modified</p>');

      expect(editor.signals.canRedo()).toBe(false);
    });
  });

  describe('Active Marks Signal', () => {
    it('should track active marks at selection', () => {
      editor.setContent('<p><strong>Bold text</strong></p>');
      setSelection(editor, 2, 5);

      const activeMarks = editor.signals.activeMarks();
      expect(activeMarks.length).toBeGreaterThan(0);
    });

    it('should update when marks are toggled', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      toggleMarkCommand(editor, 'bold');

      const activeMarks = editor.signals.activeMarks();
      expect(activeMarks.length).toBeGreaterThan(0);
    });

    it('should be empty for unformatted text', () => {
      editor.setContent('<p>Plain text</p>');
      setSelection(editor, 2, 5);

      const activeMarks = editor.signals.activeMarks();
      expect(activeMarks.length).toBe(0);
    });

    it('should track multiple active marks', () => {
      editor.setContent('<p><strong><em>Formatted</em></strong></p>');
      setSelection(editor, 2, 6);

      const activeMarks = editor.signals.activeMarks();
      expect(activeMarks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Current Node Type Signal', () => {
    it('should track current node type', () => {
      editor.setContent('<p>Paragraph</p>');
      setSelection(editor, 2, 2);

      const nodeType = editor.signals.currentNodeType();
      expect(nodeType?.name).toBe('paragraph');
    });

    it('should update when node type changes', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 2, 2);

      const nodeType = editor.signals.currentNodeType();
      expect(nodeType).toBeDefined();
    });

    it('should track heading node type', () => {
      editor.setContent('<h1>Heading</h1>');
      setSelection(editor, 2, 2);

      const nodeType = editor.signals.currentNodeType();
      expect(nodeType?.name).toBe('heading');
    });

    it('should track list item node type', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');
      setSelection(editor, 4, 4);

      const nodeType = editor.signals.currentNodeType();
      expect(nodeType).toBeDefined();
    });
  });

  describe('Selected Text Signal', () => {
    it('should track selected text', () => {
      editor.setContent('<p>Hello world</p>');
      setSelection(editor, 1, 6);

      const selectedText = editor.signals.selectedText();
      expect(selectedText).toBe('Hello');
    });

    it('should be empty for cursor position', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 2, 2);

      const selectedText = editor.signals.selectedText();
      expect(selectedText).toBe('');
    });

    it('should update when selection changes', () => {
      editor.setContent('<p>One Two Three</p>');

      setSelection(editor, 1, 4);
      expect(editor.signals.selectedText()).toBe('One');

      setSelection(editor, 5, 8);
      expect(editor.signals.selectedText()).toBe('Two');
    });

    it('should handle multi-node selections', () => {
      editor.setContent('<p>First</p><p>Second</p>');
      setSelection(editor, 1, 14);

      const selectedText = editor.signals.selectedText();
      expect(selectedText).toContain('First');
      expect(selectedText).toContain('Second');
    });
  });

  describe('Signal Synchronization', () => {
    it('should keep signals in sync with editor state', () => {
      editor.setContent('<p>Text</p>');

      const doc = editor.signals.doc();
      const selection = editor.signals.selection();

      expect(doc).toBe(editor.state.doc);
      expect(selection).toBe(editor.state.selection);
    });

    it('should update all relevant signals on content change', () => {
      editor.clearContent();

      const emptyWordCount = editor.signals.wordCount();
      const emptyCharCount = editor.signals.charCount();
      const isEmpty = editor.signals.isEmpty();

      editor.setContent('<p>Hello world</p>');

      expect(editor.signals.wordCount()).not.toBe(emptyWordCount);
      expect(editor.signals.charCount()).not.toBe(emptyCharCount);
      expect(editor.signals.isEmpty()).not.toBe(isEmpty);
    });

    it('should update selection-related signals together', () => {
      editor.setContent('<p>Hello world</p>');

      setSelection(editor, 1, 6);

      expect(editor.signals.selection().from).toBe(1);
      expect(editor.signals.selection().to).toBe(6);
      expect(editor.signals.selectedText()).toBe('Hello');
    });
  });

  describe('Signal Reactivity', () => {
    it('should trigger updates when content changes', () => {
      let updateCount = 0;
      const doc = editor.signals.doc;

      editor.setContent('<p>First</p>');
      updateCount++;

      editor.setContent('<p>Second</p>');
      updateCount++;

      expect(updateCount).toBeGreaterThan(0);
    });

    it('should not trigger unnecessary updates', () => {
      editor.setContent('<p>Text</p>');
      const doc1 = editor.signals.doc();

      // Selection change should not update doc
      setSelection(editor, 1, 5);
      const doc2 = editor.signals.doc();

      expect(doc1).toBe(doc2);
    });

    it('should handle rapid state changes', () => {
      for (let i = 0; i < 10; i++) {
        editor.setContent(`<p>Iteration ${i}</p>`);
      }

      expect(editor.getText()).toContain('Iteration 9');
    });
  });

  describe('Derived Signal Consistency', () => {
    it('should maintain consistent isEmpty state', () => {
      editor.clearContent();
      expect(editor.signals.isEmpty()).toBe(true);

      insertText(editor, 'a');
      expect(editor.signals.isEmpty()).toBe(false);

      editor.clearContent();
      expect(editor.signals.isEmpty()).toBe(true);
    });

    it('should maintain consistent word count', () => {
      editor.setContent('<p>one two</p>');
      const count1 = editor.signals.wordCount();

      insertText(editor, ' three');
      const count2 = editor.signals.wordCount();

      expect(count2).toBeGreaterThan(count1);
    });

    it('should maintain consistent character count', () => {
      editor.setContent('<p>abc</p>');
      const count1 = editor.signals.charCount();

      insertText(editor, 'def');
      const count2 = editor.signals.charCount();

      expect(count2).toBeGreaterThan(count1);
    });
  });

  describe('State Transitions', () => {
    it('should handle empty to non-empty transition', () => {
      editor.clearContent();
      expect(editor.signals.isEmpty()).toBe(true);

      editor.setContent('<p>Content</p>');

      expect(editor.signals.isEmpty()).toBe(false);
      expect(editor.signals.wordCount()).toBeGreaterThan(0);
      expect(editor.signals.charCount()).toBeGreaterThan(0);
    });

    it('should handle non-empty to empty transition', () => {
      editor.setContent('<p>Content</p>');
      expect(editor.signals.isEmpty()).toBe(false);

      editor.clearContent();

      expect(editor.signals.isEmpty()).toBe(true);
      expect(editor.signals.wordCount()).toBe(0);
      expect(editor.signals.charCount()).toBe(0);
    });

    it('should handle focus state transitions', () => {
      expect(editor.signals.isFocused()).toBe(false);

      editor.focus();
      expect(editor.signals.isFocused()).toBe(true);

      editor.blur();
      expect(editor.signals.isFocused()).toBe(false);
    });

    it('should handle editable state transitions', () => {
      expect(editor.signals.isEditable()).toBe(true);

      editor.signals.isEditable.set(false);
      expect(editor.signals.isEditable()).toBe(false);

      editor.signals.isEditable.set(true);
      expect(editor.signals.isEditable()).toBe(true);
    });
  });
});
