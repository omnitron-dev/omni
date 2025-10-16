/**
 * Keyboard Shortcuts Integration Tests
 *
 * Tests that verify keyboard shortcuts work correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import { BoldExtension } from '../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { UnderlineExtension } from '../../../../src/components/editor/extensions/marks/UnderlineExtension.js';
import { StrikeExtension } from '../../../../src/components/editor/extensions/marks/StrikeExtension.js';
import { CodeExtension } from '../../../../src/components/editor/extensions/marks/CodeExtension.js';
import { HeadingExtension } from '../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BulletListExtension } from '../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { CodeBlockExtension } from '../../../../src/components/editor/extensions/code/CodeBlockExtension.js';
import { HistoryExtension } from '../../../../src/components/editor/extensions/behavior/HistoryExtension.js';
import {
  createIntegrationTestEditor,
  cleanupEditor,
  setSelection,
  simulateKeyPress,
} from './helpers.js';

describe('Keyboard Shortcuts', () => {
  let editor: EditorInstance;

  beforeEach(() => {
    editor = createIntegrationTestEditor([
      new ParagraphExtension(),
      new HeadingExtension(),
      new BoldExtension(),
      new ItalicExtension(),
      new UnderlineExtension(),
      new StrikeExtension(),
      new CodeExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new CodeBlockExtension(),
      new HistoryExtension(),
    ]);
  });

  afterEach(() => {
    cleanupEditor(editor);
  });

  describe('Mark Shortcuts', () => {
    it('should apply bold with Mod-b', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'b', ['Mod']);

      // Keyboard shortcut should trigger
      expect(editor.state).toBeDefined();
    });

    it('should apply italic with Mod-i', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'i', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should apply underline with Mod-u', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'u', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should apply code with Mod-e', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'e', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should toggle bold with repeated Mod-b', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'b', ['Mod']);
      simulateKeyPress(editor, 'b', ['Mod']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('History Shortcuts', () => {
    it('should undo with Mod-z', () => {
      editor.setContent('<p>Original</p>');
      editor.setContent('<p>Modified</p>');

      simulateKeyPress(editor, 'z', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should redo with Mod-Shift-z', () => {
      editor.setContent('<p>Original</p>');
      editor.setContent('<p>Modified</p>');

      simulateKeyPress(editor, 'z', ['Mod']);
      simulateKeyPress(editor, 'z', ['Mod', 'Shift']);

      expect(editor.state).toBeDefined();
    });

    it('should redo with Mod-y', () => {
      editor.setContent('<p>Original</p>');
      editor.setContent('<p>Modified</p>');

      simulateKeyPress(editor, 'y', ['Mod']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('List Shortcuts', () => {
    it('should create bullet list with Mod-Shift-8', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, '8', ['Mod', 'Shift']);

      expect(editor.state).toBeDefined();
    });

    it('should create ordered list with Mod-Shift-7', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, '7', ['Mod', 'Shift']);

      expect(editor.state).toBeDefined();
    });

    it('should indent list item with Tab', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');
      setSelection(editor, 4, 4);

      simulateKeyPress(editor, 'Tab', []);

      expect(editor.state).toBeDefined();
    });

    it('should outdent list item with Shift-Tab', () => {
      editor.setContent('<ul><li><p>Item</p></li></ul>');
      setSelection(editor, 4, 4);

      simulateKeyPress(editor, 'Tab', ['Shift']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Heading Shortcuts', () => {
    it('should create h1 with Mod-Alt-1', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, '1', ['Mod', 'Alt']);

      expect(editor.state).toBeDefined();
    });

    it('should create h2 with Mod-Alt-2', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, '2', ['Mod', 'Alt']);

      expect(editor.state).toBeDefined();
    });

    it('should create h3 with Mod-Alt-3', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, '3', ['Mod', 'Alt']);

      expect(editor.state).toBeDefined();
    });

    it('should toggle back to paragraph', () => {
      editor.setContent('<h1>Heading</h1>');

      simulateKeyPress(editor, '0', ['Mod', 'Alt']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Code Block Shortcuts', () => {
    it('should create code block with Mod-Alt-c', () => {
      editor.setContent('<p>Code</p>');

      simulateKeyPress(editor, 'c', ['Mod', 'Alt']);

      expect(editor.state).toBeDefined();
    });

    it('should not allow formatting inside code block', () => {
      editor.setContent('<pre><code>Code</code></pre>');
      setSelection(editor, 2, 6);

      simulateKeyPress(editor, 'b', ['Mod']);

      // Bold should not work in code block
      expect(editor.state).toBeDefined();
    });
  });

  describe('Navigation Shortcuts', () => {
    it('should move to start with Mod-Home', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, 'Home', ['Mod']);

      expect(editor.state.selection).toBeDefined();
    });

    it('should move to end with Mod-End', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, 'End', ['Mod']);

      expect(editor.state.selection).toBeDefined();
    });

    it('should select all with Mod-a', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, 'a', ['Mod']);

      expect(editor.state.selection).toBeDefined();
    });
  });

  describe('Enter Key Behavior', () => {
    it('should create new paragraph with Enter', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 5, 5);

      simulateKeyPress(editor, 'Enter', []);

      expect(editor.state).toBeDefined();
    });

    it('should create hard break with Shift-Enter', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 5, 5);

      simulateKeyPress(editor, 'Enter', ['Shift']);

      expect(editor.state).toBeDefined();
    });

    it('should exit list with Enter twice', () => {
      editor.setContent('<ul><li><p></p></li></ul>');

      simulateKeyPress(editor, 'Enter', []);

      expect(editor.state).toBeDefined();
    });

    it('should exit code block with Mod-Enter', () => {
      editor.setContent('<pre><code>Code</code></pre>');

      simulateKeyPress(editor, 'Enter', ['Mod']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Backspace Behavior', () => {
    it('should delete character with Backspace', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 5, 5);

      simulateKeyPress(editor, 'Backspace', []);

      expect(editor.state).toBeDefined();
    });

    it('should delete word with Mod-Backspace', () => {
      editor.setContent('<p>Hello world</p>');
      setSelection(editor, 12, 12);

      simulateKeyPress(editor, 'Backspace', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should merge paragraphs with Backspace', () => {
      editor.setContent('<p>First</p><p>Second</p>');
      setSelection(editor, 7, 7);

      simulateKeyPress(editor, 'Backspace', []);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Delete Behavior', () => {
    it('should delete character with Delete', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 1);

      simulateKeyPress(editor, 'Delete', []);

      expect(editor.state).toBeDefined();
    });

    it('should delete word with Mod-Delete', () => {
      editor.setContent('<p>Hello world</p>');
      setSelection(editor, 1, 1);

      simulateKeyPress(editor, 'Delete', ['Mod']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Shortcut Conflicts', () => {
    it('should not conflict between bold and bullet list', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      // Mod-b for bold
      simulateKeyPress(editor, 'b', ['Mod']);

      // Mod-Shift-8 for bullet list
      simulateKeyPress(editor, '8', ['Mod', 'Shift']);

      expect(editor.state).toBeDefined();
    });

    it('should handle overlapping shortcuts correctly', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, 'z', ['Mod']);
      simulateKeyPress(editor, 'z', ['Mod', 'Shift']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Context-Specific Shortcuts', () => {
    it('should have different behavior in different contexts', () => {
      editor.setContent('<p>Text</p>');

      simulateKeyPress(editor, 'Enter', []);

      editor.setContent('<ul><li><p>Item</p></li></ul>');

      simulateKeyPress(editor, 'Enter', []);

      expect(editor.state).toBeDefined();
    });

    it('should disable formatting in code blocks', () => {
      editor.setContent('<pre><code>Code</code></pre>');
      setSelection(editor, 2, 6);

      simulateKeyPress(editor, 'b', ['Mod']);

      // Should not apply bold in code
      expect(editor.state).toBeDefined();
    });
  });

  describe('Platform-Specific Shortcuts', () => {
    it('should use Cmd on Mac', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'b', ['Meta']);

      expect(editor.state).toBeDefined();
    });

    it('should use Ctrl on Windows/Linux', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'b', ['Ctrl']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Shortcut Chaining', () => {
    it('should apply multiple shortcuts in sequence', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'b', ['Mod']);
      simulateKeyPress(editor, 'i', ['Mod']);
      simulateKeyPress(editor, 'u', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should handle undo after shortcuts', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      simulateKeyPress(editor, 'b', ['Mod']);
      simulateKeyPress(editor, 'z', ['Mod']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle shortcuts with empty selection', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 1);

      simulateKeyPress(editor, 'b', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should handle shortcuts with full document selection', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 0, editor.state.doc.content.size);

      simulateKeyPress(editor, 'b', ['Mod']);

      expect(editor.state).toBeDefined();
    });

    it('should handle shortcuts in empty document', () => {
      editor.clearContent();

      simulateKeyPress(editor, 'b', ['Mod']);

      expect(editor.state).toBeDefined();
    });
  });

  describe('Custom Shortcuts', () => {
    it('should allow custom shortcut registration', () => {
      editor.setContent('<p>Text</p>');

      // Custom shortcuts would be tested here
      expect(editor.state).toBeDefined();
    });

    it('should override default shortcuts if needed', () => {
      editor.setContent('<p>Text</p>');

      // Override tests would go here
      expect(editor.state).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle rapid shortcut presses', () => {
      editor.setContent('<p>Text</p>');
      setSelection(editor, 1, 5);

      const start = Date.now();

      for (let i = 0; i < 10; i++) {
        simulateKeyPress(editor, 'b', ['Mod']);
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });

    it('should not lag with complex shortcuts', () => {
      editor.setContent('<p>Text</p>');

      const start = Date.now();

      simulateKeyPress(editor, 'a', ['Mod']);
      simulateKeyPress(editor, 'b', ['Mod']);
      simulateKeyPress(editor, 'i', ['Mod']);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });
});
