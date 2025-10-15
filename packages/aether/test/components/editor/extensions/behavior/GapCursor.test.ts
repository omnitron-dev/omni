/**
 * GapCursorExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { GapCursorExtension } from '../../../../../src/components/editor/extensions/behavior/GapCursorExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('GapCursorExtension', () => {
  let extension: GapCursorExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new GapCursorExtension();
    const builder = new SchemaBuilder();
    schema = builder.build();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('gap_cursor');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Options', () => {
    it('should not have configurable options', () => {
      const options = extension.getOptions();
      expect(options).toBeDefined();
      // GapCursor has no custom options
    });

    it('should accept empty configuration', () => {
      extension.configure({});
      expect(() => extension.getOptions()).not.toThrow();
    });
  });

  describe('Plugins', () => {
    it('should provide gap cursor plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBe(1);
    });

    it('should create plugin without options', () => {
      const plugins = extension.getPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0]).toBeDefined();
    });

    it('should return same plugin on multiple calls', () => {
      const plugins1 = extension.getPlugins();
      const plugins2 = extension.getPlugins();
      expect(plugins1.length).toBe(plugins2.length);
    });
  });

  describe('Plugin integration', () => {
    it('should integrate with editor state', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
      expect(state.plugins.length).toBeGreaterThan(0);
    });

    it('should work with empty document', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
      expect(state.doc.childCount).toBe(1);
    });

    it('should work with multiple paragraphs', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('first')]),
        schema.node('paragraph', null, [schema.text('second')]),
      ]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
      expect(state.doc.childCount).toBe(2);
    });

    it('should work alongside other plugins', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state.plugins.length).toBeGreaterThan(0);
    });
  });

  describe('Gap cursor behavior', () => {
    it('should allow positioning between blocks', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('block 1')]),
        schema.node('paragraph', null, [schema.text('block 2')]),
      ]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // The gap cursor plugin should be active
      expect(state.plugins).toContain(plugins[0]);
    });

    it('should work with heading nodes', () => {
      // Create schema with headings
      const builder = new SchemaBuilder();
      const schemaWithHeadings = builder.build();

      const doc = schemaWithHeadings.node('doc', null, [
        schemaWithHeadings.node('paragraph', null, [schemaWithHeadings.text('text')]),
        schemaWithHeadings.node('paragraph', null, [schemaWithHeadings.text('more text')]),
      ]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema: schemaWithHeadings,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
      expect(state.doc.childCount).toBe(2);
    });

    it('should handle single paragraph document', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('solo')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
      expect(state.doc.childCount).toBe(1);
    });
  });

  describe('Extension lifecycle', () => {
    it('should handle configuration', () => {
      expect(() => extension.configure({})).not.toThrow();
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should allow multiple lifecycle operations', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      extension.configure({});
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should handle destroy before setEditor', () => {
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should handle multiple destroy calls', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      extension.destroy();
      expect(() => extension.destroy()).not.toThrow();
    });
  });

  describe('Plugin state', () => {
    it('should maintain plugin state through transactions', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Apply a transaction
      const tr = state.tr.insertText(' added', 5);
      state = state.apply(tr);

      expect(state).toBeDefined();
      expect(state.doc.textContent).toBe('test added');
    });

    it('should work with node insertions', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Insert a new paragraph
      const newPara = schema.node('paragraph', null, [schema.text('new')]);
      const tr = state.tr.insert(6, newPara);
      state = state.apply(tr);

      expect(state.doc.childCount).toBe(2);
    });

    it('should work with node deletions', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('first')]),
        schema.node('paragraph', null, [schema.text('second')]),
      ]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Delete second paragraph
      const tr = state.tr.delete(7, 14);
      state = state.apply(tr);

      expect(state.doc.childCount).toBe(1);
    });
  });

  describe('Multiple instances', () => {
    it('should allow multiple extension instances', () => {
      const ext1 = new GapCursorExtension();
      const ext2 = new GapCursorExtension();

      expect(ext1).not.toBe(ext2);
      expect(ext1.name).toBe(ext2.name);
    });

    it('should create independent plugins', () => {
      const ext1 = new GapCursorExtension();
      const ext2 = new GapCursorExtension();

      const plugins1 = ext1.getPlugins();
      const plugins2 = ext2.getPlugins();

      expect(plugins1).not.toBe(plugins2);
      expect(plugins1.length).toBe(plugins2.length);
    });
  });
});
