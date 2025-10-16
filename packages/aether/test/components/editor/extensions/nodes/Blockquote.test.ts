/**
 * BlockquoteExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { BlockquoteExtension } from '../../../../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
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
  const nodes: any = {
    doc: { content: 'block+' },
    text: { group: 'inline' },
  };
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

  // Fix blockquote to prevent infinite recursion - only allow paragraph inside
  if (nodes.blockquote && nodes.paragraph) {
    nodes.blockquote = {
      ...nodes.blockquote,
      content: 'paragraph+',
    };
  }

  return new Schema({ nodes, marks });
}

describe('BlockquoteExtension', () => {
  let extension: BlockquoteExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new BlockquoteExtension();
    const paragraph = new ParagraphExtension();
    schema = buildSchema([extension, paragraph]);
    const editor = createMockEditor(schema);
    extension.setEditor(editor);
  });

  describe('Basic properties', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('blockquote');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should support HTML attributes', () => {
      const ext = new BlockquoteExtension({ HTMLAttributes: { class: 'custom-quote' } });
      const options = ext.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-quote' });
    });

    it('should have empty HTML attributes by default', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });
  });

  describe('Schema', () => {
    it('should provide blockquote node spec', () => {
      const schemaContrib = extension.getSchema();
      expect(schemaContrib).toBeDefined();
      expect(schemaContrib?.nodes?.blockquote).toBeDefined();
    });

    it('should have correct content model', () => {
      const schemaContrib = extension.getSchema();
      const blockquote = schemaContrib?.nodes?.blockquote;
      expect(blockquote?.content).toBe('block+');
      expect(blockquote?.group).toBe('block');
      expect(blockquote?.defining).toBe(true);
    });

    it('should have parseDOM rule for <blockquote> tags', () => {
      const schemaContrib = extension.getSchema();
      const blockquote = schemaContrib?.nodes?.blockquote;
      expect(blockquote?.parseDOM).toEqual([{ tag: 'blockquote' }]);
    });

    it('should have toDOM function', () => {
      const schemaContrib = extension.getSchema();
      const blockquote = schemaContrib?.nodes?.blockquote;
      expect(blockquote?.toDOM).toBeDefined();

      // Test toDOM output
      const dom = blockquote?.toDOM?.();
      expect(dom).toEqual(['blockquote', {}, 0]);
    });

    it('should include HTML attributes in toDOM', () => {
      const ext = new BlockquoteExtension({ HTMLAttributes: { class: 'quote' } });
      const schemaContrib = ext.getSchema();
      const blockquote = schemaContrib?.nodes?.blockquote;

      const dom = blockquote?.toDOM?.();
      expect(dom).toEqual(['blockquote', { class: 'quote' }, 0]);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-Shift-b shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-Shift-b']).toBeDefined();
    });

    it('should wrap paragraph in blockquote on shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const shortcut = shortcuts?.['Mod-Shift-b'];
      const result = shortcut?.(state, dispatch);

      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('blockquote');
      expect(newState.doc.firstChild?.firstChild?.type.name).toBe('paragraph');
    });

    it('should unwrap blockquote on shortcut when inside blockquote', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const doc = schema.node('doc', null, [
        schema.node('blockquote', null, [schema.node('paragraph', null, [schema.text('test')])]),
      ]);

      const state = EditorState.create({
        schema,
        doc,
        // Position cursor inside the paragraph within blockquote (position 2)
        selection: EditorState.create({ schema, doc }).selection,
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const shortcut = shortcuts?.['Mod-Shift-b'];
      const result = shortcut?.(state, dispatch);

      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });
  });

  describe('Commands', () => {
    it('should provide blockquote command', () => {
      const commands = extension.getCommands();
      expect(commands?.blockquote).toBeDefined();
    });

    it('should provide toggleBlockquote command', () => {
      const commands = extension.getCommands();
      expect(commands?.toggleBlockquote).toBeDefined();
    });

    it('should provide wrapInBlockquote command', () => {
      const commands = extension.getCommands();
      expect(commands?.wrapInBlockquote).toBeDefined();
    });

    it('should wrap paragraph in blockquote', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.blockquote()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('blockquote');
      expect(newState.doc.firstChild?.firstChild?.type.name).toBe('paragraph');
    });

    it('should toggle blockquote on', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.toggleBlockquote()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('blockquote');
    });

    it('should toggle blockquote off', () => {
      const commands = extension.getCommands();
      const doc = schema.node('doc', null, [
        schema.node('blockquote', null, [schema.node('paragraph', null, [schema.text('test')])]),
      ]);

      const state = EditorState.create({
        schema,
        doc,
        selection: EditorState.create({ schema, doc }).selection,
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.toggleBlockquote()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });

    it('should work with wrapInBlockquote alias', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.wrapInBlockquote()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('blockquote');
    });
  });

  describe('Input rules', () => {
    it('should provide input rules', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toBeDefined();
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should have input rule for > character', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toHaveLength(1);
    });
  });

  describe('Node creation', () => {
    it('should create blockquote nodes', () => {
      const paragraph = schema.node('paragraph', null, [schema.text('test')]);
      const node = schema.nodes.blockquote.create(null, paragraph);
      expect(node.type.name).toBe('blockquote');
    });

    it('should require block content', () => {
      const paragraph = schema.node('paragraph', null, [schema.text('test')]);
      const node = schema.nodes.blockquote.create(null, paragraph);
      expect(node.childCount).toBe(1);
      expect(node.firstChild?.isBlock).toBe(true);
    });

    it('should support multiple paragraphs', () => {
      const p1 = schema.node('paragraph', null, [schema.text('first')]);
      const p2 = schema.node('paragraph', null, [schema.text('second')]);
      const node = schema.nodes.blockquote.create(null, [p1, p2]);
      expect(node.childCount).toBe(2);
      expect(node.textContent).toBe('firstsecond');
    });
  });

  describe('Nested content', () => {
    it('should allow block content in schema definition', () => {
      // In real usage, blockquote can contain any block node (including nested blockquotes)
      // Our test schema restricts it to paragraphs to avoid infinite recursion
      const schemaContrib = extension.getSchema();
      const blockquote = schemaContrib?.nodes?.blockquote;
      expect(blockquote?.content).toBe('block+');
    });

    it('should preserve content when wrapping', () => {
      const paragraph = schema.node('paragraph', null, [schema.text('content to preserve')]);
      const blockquote = schema.nodes.blockquote.create(null, paragraph);

      expect(blockquote.textContent).toBe('content to preserve');
    });
  });
});
