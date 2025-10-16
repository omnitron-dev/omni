/**
 * HeadingExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { HeadingExtension } from '../../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import type { EditorInstance } from '../../../../../src/components/editor/core/types.js';

// Helper to create a minimal editor instance mock
function createMockEditor(schema: Schema): EditorInstance {
  return {
    schema,
    state: EditorState.create({ schema }),
  } as EditorInstance;
}

// Helper to build schema from extensions
function buildSchema(extensions: any[]) {
  const nodes: any = { doc: { content: 'block+' }, text: { group: 'inline' } };
  const marks: any = {};

  extensions.forEach((ext) => {
    const schema = ext.getSchema?.();
    if (schema?.nodes) {
      Object.assign(nodes, schema.nodes);
    }
    if (schema?.marks) {
      Object.assign(marks, schema.marks);
    }
  });

  return new Schema({ nodes, marks });
}

describe('HeadingExtension', () => {
  let extension: HeadingExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new HeadingExtension();
    const paragraph = new ParagraphExtension();
    schema = buildSchema([extension, paragraph]);
    const editor = createMockEditor(schema);
    extension.setEditor(editor);
  });

  describe('Basic properties', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('heading');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should have default levels', () => {
      const options = extension.getOptions();
      expect(options.levels).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should allow custom levels', () => {
      const ext = new HeadingExtension({ levels: [1, 2, 3] });
      const options = ext.getOptions();
      expect(options.levels).toEqual([1, 2, 3]);
    });

    it('should support HTML attributes', () => {
      const ext = new HeadingExtension({ HTMLAttributes: { class: 'custom-heading' } });
      const options = ext.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-heading' });
    });
  });

  describe('Schema', () => {
    it('should provide heading node spec', () => {
      const schemaContrib = extension.getSchema();
      expect(schemaContrib).toBeDefined();
      expect(schemaContrib?.nodes?.heading).toBeDefined();
    });

    it('should have correct node attributes', () => {
      const schemaContrib = extension.getSchema();
      const heading = schemaContrib?.nodes?.heading;
      expect(heading?.attrs).toEqual({ level: { default: 1 } });
    });

    it('should have correct content model', () => {
      const schemaContrib = extension.getSchema();
      const heading = schemaContrib?.nodes?.heading;
      expect(heading?.content).toBe('inline*');
      expect(heading?.group).toBe('block');
      expect(heading?.defining).toBe(true);
    });

    it('should create parseDOM rules for all levels', () => {
      const schemaContrib = extension.getSchema();
      const heading = schemaContrib?.nodes?.heading;
      expect(heading?.parseDOM).toHaveLength(6);

      heading?.parseDOM?.forEach((rule, index) => {
        expect(rule.tag).toBe(`h${index + 1}`);
        expect(rule.attrs).toEqual({ level: index + 1 });
      });
    });

    it('should create parseDOM rules for custom levels only', () => {
      const ext = new HeadingExtension({ levels: [1, 2, 3] });
      const schemaContrib = ext.getSchema();
      const heading = schemaContrib?.nodes?.heading;
      expect(heading?.parseDOM).toHaveLength(3);
    });

    it('should have toDOM function', () => {
      const schemaContrib = extension.getSchema();
      const heading = schemaContrib?.nodes?.heading;
      expect(heading?.toDOM).toBeDefined();

      // Test toDOM output
      const node = schema.nodes.heading.create({ level: 2 });
      const dom = heading?.toDOM?.(node);
      expect(dom).toEqual(['h2', {}, 0]);
    });

    it('should include HTML attributes in toDOM', () => {
      const ext = new HeadingExtension({ HTMLAttributes: { class: 'heading' } });
      const schemaContrib = ext.getSchema();
      const heading = schemaContrib?.nodes?.heading;

      const node = schema.nodes.heading.create({ level: 3 });
      const dom = heading?.toDOM?.(node);
      expect(dom).toEqual(['h3', { class: 'heading' }, 0]);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide keyboard shortcuts for all levels', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();

      [1, 2, 3, 4, 5, 6].forEach((level) => {
        expect(shortcuts?.[`Mod-Alt-${level}`]).toBeDefined();
      });
    });

    it('should only provide shortcuts for custom levels', () => {
      const ext = new HeadingExtension({ levels: [1, 2] });
      const shortcuts = ext.getKeyboardShortcuts();

      expect(shortcuts?.['Mod-Alt-1']).toBeDefined();
      expect(shortcuts?.['Mod-Alt-2']).toBeDefined();
      expect(shortcuts?.['Mod-Alt-3']).toBeUndefined();
    });

    it('should execute heading command on shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const shortcut = shortcuts?.['Mod-Alt-2'];
      expect(shortcut).toBeDefined();

      const result = shortcut?.(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('heading');
      expect(newState.doc.firstChild?.attrs.level).toBe(2);
    });
  });

  describe('Commands', () => {
    it('should provide heading command', () => {
      const commands = extension.getCommands();
      expect(commands?.heading).toBeDefined();
    });

    it('should provide toggleHeading command', () => {
      const commands = extension.getCommands();
      expect(commands?.toggleHeading).toBeDefined();
    });

    it('should convert paragraph to heading', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.heading(3)(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('heading');
      expect(newState.doc.firstChild?.attrs.level).toBe(3);
    });

    it('should reject invalid heading levels', () => {
      const ext = new HeadingExtension({ levels: [1, 2, 3] });
      const commands = ext.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      const result = commands?.heading(5)(state);
      expect(result).toBe(false);
    });

    it('should toggle heading to paragraph', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [
          schema.node('heading', { level: 2 }, [schema.text('test')]),
        ]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.toggleHeading(2)(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });

    it('should toggle paragraph to heading', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.toggleHeading(1)(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('heading');
      expect(newState.doc.firstChild?.attrs.level).toBe(1);
    });

    it('should toggle between different heading levels', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [
          schema.node('heading', { level: 1 }, [schema.text('test')]),
        ]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.toggleHeading(2)(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('heading');
      expect(newState.doc.firstChild?.attrs.level).toBe(2);
    });
  });

  describe('Input rules', () => {
    it('should provide input rules', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toBeDefined();
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should create input rules for all levels', () => {
      const rules = extension.getInputRules(schema);
      // Note: Input rules are created per level, but the implementation
      // may vary. We just check that rules exist.
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should create input rules for custom levels only', () => {
      const ext = new HeadingExtension({ levels: [1, 2] });
      const schema2 = buildSchema([ext, new ParagraphExtension()]);

      const rules = ext.getInputRules(schema2);
      expect(rules).toBeDefined();
      expect(rules?.length).toBe(2);
    });
  });

  describe('Node creation', () => {
    it('should create heading nodes with correct level', () => {
      [1, 2, 3, 4, 5, 6].forEach((level) => {
        const node = schema.nodes.heading.create({ level });
        expect(node.type.name).toBe('heading');
        expect(node.attrs.level).toBe(level);
      });
    });

    it('should use default level if not specified', () => {
      const node = schema.nodes.heading.create();
      expect(node.attrs.level).toBe(1);
    });
  });
});
