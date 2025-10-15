/**
 * DropCursorExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { DropCursorExtension } from '../../../../../src/components/editor/extensions/behavior/DropCursorExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('DropCursorExtension', () => {
  let extension: DropCursorExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new DropCursorExtension();
    const builder = new SchemaBuilder();
    schema = builder.build();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('drop_cursor');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have default color', () => {
      const options = extension.getOptions();
      expect(options.color).toBe('#000');
    });

    it('should have default width', () => {
      const options = extension.getOptions();
      expect(options.width).toBe(1);
    });

    it('should not have default class', () => {
      const options = extension.getOptions();
      expect(options.class).toBeUndefined();
    });
  });

  describe('Custom options', () => {
    it('should accept custom color', () => {
      const customExtension = new DropCursorExtension({ color: '#ff0000' });
      const options = customExtension.getOptions();
      expect(options.color).toBe('#ff0000');
    });

    it('should accept custom width', () => {
      const customExtension = new DropCursorExtension({ width: 2 });
      const options = customExtension.getOptions();
      expect(options.width).toBe(2);
    });

    it('should accept custom class', () => {
      const customExtension = new DropCursorExtension({ class: 'custom-drop-cursor' });
      const options = customExtension.getOptions();
      expect(options.class).toBe('custom-drop-cursor');
    });

    it('should accept multiple custom options', () => {
      const customExtension = new DropCursorExtension({
        color: '#00ff00',
        width: 3,
        class: 'my-cursor',
      });
      const options = customExtension.getOptions();
      expect(options.color).toBe('#00ff00');
      expect(options.width).toBe(3);
      expect(options.class).toBe('my-cursor');
    });

    it('should configure options after creation', () => {
      extension.configure({ color: '#0000ff' });
      const options = extension.getOptions();
      expect(options.color).toBe('#0000ff');
    });
  });

  describe('Plugins', () => {
    it('should provide drop cursor plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBe(1);
    });

    it('should create plugin with default options', () => {
      const plugins = extension.getPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0]).toBeDefined();
    });

    it('should create plugin with custom color', () => {
      const customExtension = new DropCursorExtension({ color: '#ff0000' });
      const plugins = customExtension.getPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0]).toBeDefined();
    });

    it('should create plugin with custom width', () => {
      const customExtension = new DropCursorExtension({ width: 2 });
      const plugins = customExtension.getPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0]).toBeDefined();
    });

    it('should create plugin with custom class', () => {
      const customExtension = new DropCursorExtension({ class: 'custom-class' });
      const plugins = customExtension.getPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0]).toBeDefined();
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

    it('should work alongside other plugins', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      // Additional plugins could be added here
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state.plugins.length).toBeGreaterThan(0);
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { color: '#ff00ff', width: 2 };
      extension.configure(options);
      expect(extension.getOptions()).toMatchObject(options);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should merge configured options with defaults', () => {
      extension.configure({ color: '#123456' });
      const options = extension.getOptions();
      expect(options.color).toBe('#123456');
      expect(options.width).toBe(1); // Default still present
    });

    it('should allow reconfiguration', () => {
      extension.configure({ color: '#aaa' });
      expect(extension.getOptions().color).toBe('#aaa');

      extension.configure({ color: '#bbb' });
      expect(extension.getOptions().color).toBe('#bbb');
    });
  });

  describe('Color option validation', () => {
    it('should accept hex colors', () => {
      const customExtension = new DropCursorExtension({ color: '#ffffff' });
      expect(customExtension.getOptions().color).toBe('#ffffff');
    });

    it('should accept short hex colors', () => {
      const customExtension = new DropCursorExtension({ color: '#fff' });
      expect(customExtension.getOptions().color).toBe('#fff');
    });

    it('should accept rgb colors', () => {
      const customExtension = new DropCursorExtension({ color: 'rgb(255, 0, 0)' });
      expect(customExtension.getOptions().color).toBe('rgb(255, 0, 0)');
    });

    it('should accept rgba colors', () => {
      const customExtension = new DropCursorExtension({ color: 'rgba(255, 0, 0, 0.5)' });
      expect(customExtension.getOptions().color).toBe('rgba(255, 0, 0, 0.5)');
    });

    it('should accept named colors', () => {
      const customExtension = new DropCursorExtension({ color: 'red' });
      expect(customExtension.getOptions().color).toBe('red');
    });
  });

  describe('Width option validation', () => {
    it('should accept positive numbers', () => {
      const customExtension = new DropCursorExtension({ width: 5 });
      expect(customExtension.getOptions().width).toBe(5);
    });

    it('should accept fractional widths', () => {
      const customExtension = new DropCursorExtension({ width: 1.5 });
      expect(customExtension.getOptions().width).toBe(1.5);
    });

    it('should accept zero width', () => {
      const customExtension = new DropCursorExtension({ width: 0 });
      expect(customExtension.getOptions().width).toBe(0);
    });
  });
});
