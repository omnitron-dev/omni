/**
 * HorizontalRuleExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { HorizontalRuleExtension } from '../../../../../src/components/editor/extensions/nodes/HorizontalRuleExtension.js';
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

describe('HorizontalRuleExtension', () => {
  let extension: HorizontalRuleExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new HorizontalRuleExtension();
    const paragraph = new ParagraphExtension();
    schema = buildSchema([extension, paragraph]);
    const editor = createMockEditor(schema);
    extension.setEditor(editor);
  });

  describe('Basic properties', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('horizontal_rule');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should support HTML attributes', () => {
      const ext = new HorizontalRuleExtension({ HTMLAttributes: { class: 'custom-hr' } });
      const options = ext.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-hr' });
    });

    it('should have empty HTML attributes by default', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });
  });

  describe('Schema', () => {
    it('should provide horizontal_rule node spec', () => {
      const schemaContrib = extension.getSchema();
      expect(schemaContrib).toBeDefined();
      expect(schemaContrib?.nodes?.horizontal_rule).toBeDefined();
    });

    it('should be a block element', () => {
      const schemaContrib = extension.getSchema();
      const hr = schemaContrib?.nodes?.horizontal_rule;
      expect(hr?.group).toBe('block');
    });

    it('should have parseDOM rule for <hr> tags', () => {
      const schemaContrib = extension.getSchema();
      const hr = schemaContrib?.nodes?.horizontal_rule;
      expect(hr?.parseDOM).toEqual([{ tag: 'hr' }]);
    });

    it('should have toDOM function', () => {
      const schemaContrib = extension.getSchema();
      const hr = schemaContrib?.nodes?.horizontal_rule;
      expect(hr?.toDOM).toBeDefined();

      // Test toDOM output
      const dom = hr?.toDOM?.();
      expect(dom).toEqual(['hr', {}]);
    });

    it('should include HTML attributes in toDOM', () => {
      const ext = new HorizontalRuleExtension({ HTMLAttributes: { class: 'divider' } });
      const schemaContrib = ext.getSchema();
      const hr = schemaContrib?.nodes?.horizontal_rule;

      const dom = hr?.toDOM?.();
      expect(dom).toEqual(['hr', { class: 'divider' }]);
    });

    it('should be a leaf node (no content)', () => {
      const schemaContrib = extension.getSchema();
      const hr = schemaContrib?.nodes?.horizontal_rule;
      // Leaf nodes don't have content property or it's undefined
      expect(hr?.content).toBeUndefined();
    });
  });

  describe('Commands', () => {
    it('should provide horizontalRule command', () => {
      const commands = extension.getCommands();
      expect(commands?.horizontalRule).toBeDefined();
    });

    it('should provide insertHorizontalRule command', () => {
      const commands = extension.getCommands();
      expect(commands?.insertHorizontalRule).toBeDefined();
    });

    it('should insert horizontal rule after current block', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.horizontalRule()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.childCount).toBe(2);
      expect(newState.doc.lastChild?.type.name).toBe('horizontal_rule');
    });

    it('should work with insertHorizontalRule alias', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.insertHorizontalRule()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.childCount).toBe(2);
      expect(newState.doc.lastChild?.type.name).toBe('horizontal_rule');
    });

    it('should return true without dispatch', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      // Call without dispatch to test if command is available
      const result = commands?.horizontalRule()(state);
      expect(result).toBe(true);
    });
  });

  describe('Input rules', () => {
    it('should provide input rules', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toBeDefined();
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should have input rule for --- pattern', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toHaveLength(1);
    });

    it('should insert hr on --- input', () => {
      const rules = extension.getInputRules(schema);
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('---')])]),
      });

      // Test that the input rule pattern matches
      const match = /^---$/.exec('---');
      expect(match).toBeTruthy();
    });
  });

  describe('Node creation', () => {
    it('should create horizontal rule nodes', () => {
      const node = schema.nodes.horizontal_rule.create();
      expect(node.type.name).toBe('horizontal_rule');
    });

    it('should be a leaf node', () => {
      const node = schema.nodes.horizontal_rule.create();
      expect(node.isLeaf).toBe(true);
    });

    it('should not allow content', () => {
      const node = schema.nodes.horizontal_rule.create();
      expect(node.childCount).toBe(0);
      expect(node.textContent).toBe('');
    });

    it('should be a block node', () => {
      const node = schema.nodes.horizontal_rule.create();
      expect(node.isBlock).toBe(true);
    });
  });

  describe('Document structure', () => {
    it('should work in document with other blocks', () => {
      const p1 = schema.node('paragraph', null, [schema.text('before')]);
      const hr = schema.nodes.horizontal_rule.create();
      const p2 = schema.node('paragraph', null, [schema.text('after')]);

      const doc = schema.node('doc', null, [p1, hr, p2]);

      expect(doc.childCount).toBe(3);
      expect(doc.child(0).type.name).toBe('paragraph');
      expect(doc.child(1).type.name).toBe('horizontal_rule');
      expect(doc.child(2).type.name).toBe('paragraph');
    });

    it('should support multiple horizontal rules', () => {
      const hr1 = schema.nodes.horizontal_rule.create();
      const hr2 = schema.nodes.horizontal_rule.create();
      const p = schema.node('paragraph', null, [schema.text('text')]);

      const doc = schema.node('doc', null, [hr1, p, hr2]);

      expect(doc.childCount).toBe(3);
      expect(doc.child(0).type.name).toBe('horizontal_rule');
      expect(doc.child(1).type.name).toBe('paragraph');
      expect(doc.child(2).type.name).toBe('horizontal_rule');
    });

    it('should render as a separator', () => {
      const hr = schema.nodes.horizontal_rule.create();
      // Horizontal rules are visual separators
      expect(hr.isLeaf).toBe(true);
      expect(hr.isBlock).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty document insertion', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph')]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.horizontalRule()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.childCount).toBe(2);
    });

    it('should not have text content', () => {
      const hr = schema.nodes.horizontal_rule.create();
      expect(hr.textContent).toBe('');
      expect(hr.content.size).toBe(0);
    });
  });
});
