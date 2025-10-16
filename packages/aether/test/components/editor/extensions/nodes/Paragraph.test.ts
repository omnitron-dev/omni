/**
 * ParagraphExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { ParagraphExtension } from '../../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { HeadingExtension } from '../../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
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

describe('ParagraphExtension', () => {
  let extension: ParagraphExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new ParagraphExtension();
    const heading = new HeadingExtension();
    schema = buildSchema([extension, heading]);
    const editor = createMockEditor(schema);
    extension.setEditor(editor);
  });

  describe('Basic properties', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('paragraph');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should support HTML attributes', () => {
      const ext = new ParagraphExtension({ HTMLAttributes: { class: 'custom-paragraph' } });
      const options = ext.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-paragraph' });
    });

    it('should have empty HTML attributes by default', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });
  });

  describe('Schema', () => {
    it('should provide paragraph node spec', () => {
      const schemaContrib = extension.getSchema();
      expect(schemaContrib).toBeDefined();
      expect(schemaContrib?.nodes?.paragraph).toBeDefined();
    });

    it('should have correct content model', () => {
      const schemaContrib = extension.getSchema();
      const paragraph = schemaContrib?.nodes?.paragraph;
      expect(paragraph?.content).toBe('inline*');
      expect(paragraph?.group).toBe('block');
    });

    it('should have parseDOM rule for <p> tags', () => {
      const schemaContrib = extension.getSchema();
      const paragraph = schemaContrib?.nodes?.paragraph;
      expect(paragraph?.parseDOM).toEqual([{ tag: 'p' }]);
    });

    it('should have toDOM function', () => {
      const schemaContrib = extension.getSchema();
      const paragraph = schemaContrib?.nodes?.paragraph;
      expect(paragraph?.toDOM).toBeDefined();

      // Test toDOM output
      const dom = paragraph?.toDOM?.();
      expect(dom).toEqual(['p', {}, 0]);
    });

    it('should include HTML attributes in toDOM', () => {
      const ext = new ParagraphExtension({ HTMLAttributes: { class: 'paragraph' } });
      const schemaContrib = ext.getSchema();
      const paragraph = schemaContrib?.nodes?.paragraph;

      const dom = paragraph?.toDOM?.();
      expect(dom).toEqual(['p', { class: 'paragraph' }, 0]);
    });
  });

  describe('Commands', () => {
    it('should provide paragraph command', () => {
      const commands = extension.getCommands();
      expect(commands?.paragraph).toBeDefined();
    });

    it('should provide setParagraph command', () => {
      const commands = extension.getCommands();
      expect(commands?.setParagraph).toBeDefined();
    });

    it('should convert heading to paragraph', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('heading', { level: 2 }, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.paragraph()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });

    it('should work with setParagraph alias', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('heading', { level: 1 }, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.setParagraph()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });

    it('should handle already being a paragraph', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      // When already a paragraph, ProseMirror returns false as no change is needed
      const result = commands?.paragraph()(state, dispatch);
      expect(result).toBe(false);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });
  });

  describe('Node creation', () => {
    it('should create paragraph nodes', () => {
      const node = schema.nodes.paragraph.create();
      expect(node.type.name).toBe('paragraph');
    });

    it('should create paragraph with text content', () => {
      const textNode = schema.text('Hello world');
      const node = schema.nodes.paragraph.create(null, textNode);
      expect(node.type.name).toBe('paragraph');
      expect(node.textContent).toBe('Hello world');
    });

    it('should create empty paragraph', () => {
      const node = schema.nodes.paragraph.create();
      expect(node.textContent).toBe('');
    });
  });

  describe('Integration', () => {
    it('should work as default block type', () => {
      // Paragraphs are typically the default block type in editors
      const node = schema.nodes.paragraph.create(null, schema.text('default'));
      expect(node.type.name).toBe('paragraph');
      expect(node.isBlock).toBe(true);
    });

    it('should support inline content', () => {
      const textNode = schema.text('inline content');
      const node = schema.nodes.paragraph.create(null, textNode);
      expect(node.childCount).toBe(1);
      expect(node.firstChild?.isText).toBe(true);
    });
  });
});
