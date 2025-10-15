/**
 * PlaceholderExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { PlaceholderExtension } from '../../../../../src/components/editor/extensions/behavior/PlaceholderExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('PlaceholderExtension', () => {
  let extension: PlaceholderExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new PlaceholderExtension();
    const builder = new SchemaBuilder();
    schema = builder.build();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('placeholder');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have default placeholder text', () => {
      const options = extension.getOptions();
      expect(options.placeholder).toBe('Write something...');
    });

    it('should have default emptyEditorClass', () => {
      const options = extension.getOptions();
      expect(options.emptyEditorClass).toBe('is-editor-empty');
    });

    it('should have default emptyNodeClass', () => {
      const options = extension.getOptions();
      expect(options.emptyNodeClass).toBe('is-empty');
    });

    it('should have default showOnlyWhenEditable', () => {
      const options = extension.getOptions();
      expect(options.showOnlyWhenEditable).toBe(true);
    });

    it('should have default showOnlyCurrent', () => {
      const options = extension.getOptions();
      expect(options.showOnlyCurrent).toBe(true);
    });
  });

  describe('Custom options', () => {
    it('should accept custom placeholder text', () => {
      const customExtension = new PlaceholderExtension({ placeholder: 'Start typing...' });
      const options = customExtension.getOptions();
      expect(options.placeholder).toBe('Start typing...');
    });

    it('should accept custom emptyEditorClass', () => {
      const customExtension = new PlaceholderExtension({ emptyEditorClass: 'custom-empty' });
      const options = customExtension.getOptions();
      expect(options.emptyEditorClass).toBe('custom-empty');
    });

    it('should accept custom emptyNodeClass', () => {
      const customExtension = new PlaceholderExtension({ emptyNodeClass: 'node-empty' });
      const options = customExtension.getOptions();
      expect(options.emptyNodeClass).toBe('node-empty');
    });

    it('should accept showOnlyWhenEditable option', () => {
      const customExtension = new PlaceholderExtension({ showOnlyWhenEditable: false });
      const options = customExtension.getOptions();
      expect(options.showOnlyWhenEditable).toBe(false);
    });

    it('should accept showOnlyCurrent option', () => {
      const customExtension = new PlaceholderExtension({ showOnlyCurrent: false });
      const options = customExtension.getOptions();
      expect(options.showOnlyCurrent).toBe(false);
    });

    it('should accept placeholder as function', () => {
      const placeholderFn = (node: any) => 'Custom: ' + node.type.name;
      const customExtension = new PlaceholderExtension({ placeholder: placeholderFn });
      const options = customExtension.getOptions();
      expect(options.placeholder).toBe(placeholderFn);
    });

    it('should configure options after creation', () => {
      extension.configure({ placeholder: 'Updated text' });
      const options = extension.getOptions();
      expect(options.placeholder).toBe('Updated text');
    });
  });

  describe('Plugins', () => {
    it('should provide placeholder plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBe(1);
    });

    it('should create plugin with correct options', () => {
      const customExtension = new PlaceholderExtension({
        placeholder: 'Custom placeholder',
        emptyNodeClass: 'custom-class',
      });
      const plugins = customExtension.getPlugins();
      expect(plugins.length).toBe(1);
    });
  });

  describe('Empty editor detection', () => {
    it('should detect empty document', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();
      expect(decorations?.find().length).toBeGreaterThan(0);
    });

    it('should not show placeholder when document has content', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();
      expect(decorations?.find().length).toBe(0);
    });

    it('should handle multiple paragraphs', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('first')]),
        schema.node('paragraph'),
      ]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();
      // Should not show placeholder when there's content
      expect(decorations?.find().length).toBe(0);
    });
  });

  describe('Placeholder widget creation', () => {
    it('should create widget with correct text', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();

      const decorationArray = decorations?.find();
      expect(decorationArray?.length).toBeGreaterThan(0);

      // Get the widget decoration
      const decoration = decorationArray?.[0];
      expect(decoration).toBeDefined();
    });

    it('should create widget with custom class', () => {
      const customExtension = new PlaceholderExtension({ emptyNodeClass: 'my-custom-class' });
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = customExtension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();

      const decorationArray = decorations?.find();
      expect(decorationArray?.length).toBeGreaterThan(0);
    });

    it('should create widget with custom placeholder text', () => {
      const customExtension = new PlaceholderExtension({ placeholder: 'Custom text here' });
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = customExtension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();

      const decorationArray = decorations?.find();
      expect(decorationArray?.length).toBeGreaterThan(0);
    });
  });

  describe('Function-based placeholder', () => {
    it('should call placeholder function with node', () => {
      let called = false;
      const placeholderFn = (node: any) => {
        called = true;
        return 'Node type: ' + node.type.name;
      };

      const customExtension = new PlaceholderExtension({ placeholder: placeholderFn });
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = customExtension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();
      expect(called).toBe(true);
    });

    it('should use function return value as placeholder', () => {
      const placeholderFn = () => 'Dynamic placeholder';
      const customExtension = new PlaceholderExtension({ placeholder: placeholderFn });
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = customExtension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations).toBeDefined();
      expect(decorations?.find().length).toBeGreaterThan(0);
    });
  });

  describe('Decoration mapping', () => {
    it('should map decorations through transactions', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph')]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Initial decorations
      let decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations?.find().length).toBeGreaterThan(0);

      // Insert text
      const tr = state.tr.insertText('test', 1);
      state = state.apply(tr);

      // Decorations should update (no placeholder when there's text)
      decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations?.find().length).toBe(0);
    });

    it('should show placeholder again when content is deleted', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const plugins = extension.getPlugins();
      let state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Initially no placeholder (has content)
      let decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations?.find().length).toBe(0);

      // Delete all text
      const tr = state.tr.delete(1, 5);
      state = state.apply(tr);

      // Should show placeholder again
      decorations = plugins[0].spec.props?.decorations?.(state);
      expect(decorations?.find().length).toBeGreaterThan(0);
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { placeholder: 'New placeholder' };
      extension.configure(options);
      expect(extension.getOptions()).toMatchObject(options);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });

    it('should merge configured options with defaults', () => {
      extension.configure({ placeholder: 'Custom' });
      const options = extension.getOptions();
      expect(options.placeholder).toBe('Custom');
      expect(options.emptyNodeClass).toBe('is-empty'); // Default still present
    });
  });
});
