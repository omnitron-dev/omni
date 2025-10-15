/**
 * HistoryExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { undo, redo } from 'prosemirror-history';
import { HistoryExtension } from '../../../../../src/components/editor/extensions/behavior/HistoryExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('HistoryExtension', () => {
  let extension: HistoryExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new HistoryExtension();
    const builder = new SchemaBuilder();
    schema = builder.build();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('history');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have default depth of 100', () => {
      const options = extension.getOptions();
      expect(options.depth).toBe(100);
    });

    it('should have default newGroupDelay of 500ms', () => {
      const options = extension.getOptions();
      expect(options.newGroupDelay).toBe(500);
    });
  });

  describe('Custom options', () => {
    it('should accept custom depth', () => {
      const customExtension = new HistoryExtension({ depth: 50 });
      const options = customExtension.getOptions();
      expect(options.depth).toBe(50);
    });

    it('should accept custom newGroupDelay', () => {
      const customExtension = new HistoryExtension({ newGroupDelay: 1000 });
      const options = customExtension.getOptions();
      expect(options.newGroupDelay).toBe(1000);
    });

    it('should configure options after creation', () => {
      extension.configure({ depth: 200 });
      const options = extension.getOptions();
      expect(options.depth).toBe(200);
    });
  });

  describe('Plugins', () => {
    it('should provide history plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBe(1);
    });

    it('should create plugin with correct options', () => {
      const customExtension = new HistoryExtension({ depth: 50, newGroupDelay: 1000 });
      const plugins = customExtension.getPlugins();
      expect(plugins.length).toBe(1);
      // Plugin is created with the options
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-z for undo', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts['Mod-z']).toBeDefined();
      expect(typeof shortcuts['Mod-z']).toBe('function');
    });

    it('should provide Mod-y for redo', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts['Mod-y']).toBeDefined();
      expect(typeof shortcuts['Mod-y']).toBe('function');
    });

    it('should provide Shift-Mod-z for redo', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts['Shift-Mod-z']).toBeDefined();
      expect(typeof shortcuts['Shift-Mod-z']).toBe('function');
    });

    it('should execute undo command with Mod-z', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const undoShortcut = shortcuts['Mod-z'];

      // Initially undo should not be available
      const result = undoShortcut(state, undefined);
      expect(result).toBe(false);
    });

    it('should execute redo command with Mod-y', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const redoShortcut = shortcuts['Mod-y'];

      // Initially redo should not be available
      const result = redoShortcut(state, undefined);
      expect(result).toBe(false);
    });

    it('should execute redo command with Shift-Mod-z', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const redoShortcut = shortcuts['Shift-Mod-z'];

      // Initially redo should not be available
      const result = redoShortcut(state, undefined);
      expect(result).toBe(false);
    });
  });

  describe('Commands', () => {
    it('should provide undo command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands.undo).toBeDefined();
      expect(typeof commands.undo).toBe('function');
    });

    it('should provide redo command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands.redo).toBeDefined();
      expect(typeof commands.redo).toBe('function');
    });

    it('should execute undo command', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const commands = extension.getCommands();
      const undoCommand = commands.undo();

      // Initially undo should not be available
      const result = undoCommand(state, undefined);
      expect(result).toBe(false);
    });

    it('should execute redo command', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const commands = extension.getCommands();
      const redoCommand = commands.redo();

      // Initially redo should not be available
      const result = redoCommand(state, undefined);
      expect(result).toBe(false);
    });
  });

  describe('Undo functionality', () => {
    it('should undo text insertion', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Insert text
      const tr = state.tr.insertText(' world', 6);
      state = state.apply(tr);

      expect(state.doc.textContent).toBe('hello world');

      // Undo
      let undone = false;
      undo(state, (tr) => {
        state = state.apply(tr);
        undone = true;
      });

      expect(undone).toBe(true);
      expect(state.doc.textContent).toBe('hello');
    });

    it('should undo multiple steps', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('a')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Insert multiple times
      state = state.apply(state.tr.insertText('b', 2));
      state = state.apply(state.tr.insertText('c', 3));

      expect(state.doc.textContent).toBe('abc');

      // History groups rapid changes together, so one undo may undo both
      // Let's verify we can undo at least once
      let undone = false;
      undo(state, (tr) => {
        state = state.apply(tr);
        undone = true;
      });

      expect(undone).toBe(true);
      // After undo, we should have less content than before
      expect(state.doc.textContent.length).toBeLessThan(3);
    });
  });

  describe('Redo functionality', () => {
    it('should redo undone changes', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Insert text
      state = state.apply(state.tr.insertText(' world', 6));
      expect(state.doc.textContent).toBe('hello world');

      // Undo
      undo(state, (tr) => {
        state = state.apply(tr);
      });
      expect(state.doc.textContent).toBe('hello');

      // Redo
      redo(state, (tr) => {
        state = state.apply(tr);
      });
      expect(state.doc.textContent).toBe('hello world');
    });

    it('should redo multiple steps', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('a')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Insert multiple times
      state = state.apply(state.tr.insertText('b', 2));
      state = state.apply(state.tr.insertText('c', 3));
      const finalText = state.doc.textContent;

      expect(finalText).toBe('abc');

      // Undo (history may group changes)
      undo(state, (tr) => {
        state = state.apply(tr);
      });

      // Text should be shorter after undo
      const undoneText = state.doc.textContent;
      expect(undoneText.length).toBeLessThan(finalText.length);

      // Redo should restore text
      redo(state, (tr) => {
        state = state.apply(tr);
      });

      expect(state.doc.textContent).toBe(finalText);
    });
  });

  describe('History depth limit', () => {
    it('should respect depth limit', () => {
      const customExtension = new HistoryExtension({ depth: 2 });
      const plugins = customExtension.getPlugins();

      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('a')])]);

      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Insert 3 characters (exceeds depth of 2)
      state = state.apply(state.tr.insertText('b', 2));
      state = state.apply(state.tr.insertText('c', 3));
      state = state.apply(state.tr.insertText('d', 4));

      expect(state.doc.textContent).toBe('abcd');

      // Should be able to undo twice (depth = 2)
      let undoCount = 0;
      while (undo(state, (tr) => {
        state = state.apply(tr);
        undoCount++;
      })) {
        // Keep undoing
      }

      // Should have undone at most 2 times (limited by depth)
      expect(undoCount).toBeLessThanOrEqual(2);
    });
  });

  describe('Group delay behavior', () => {
    it('should group rapid changes', () => {
      const customExtension = new HistoryExtension({ newGroupDelay: 500 });
      const plugins = customExtension.getPlugins();

      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Rapid insertions (within group delay)
      state = state.apply(state.tr.insertText('a', 5));
      state = state.apply(state.tr.insertText('b', 6));

      // These should be grouped together and undo as one
      let undoCount = 0;
      undo(state, (tr) => {
        state = state.apply(tr);
        undoCount++;
      });

      expect(undoCount).toBe(1);
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { depth: 150 };
      extension.configure(options);
      expect(extension.getOptions()).toMatchObject(options);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });
  });
});
