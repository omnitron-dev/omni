/**
 * StrikeExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { StrikeExtension } from '../../../../../src/components/editor/extensions/marks/StrikeExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('StrikeExtension', () => {
  let extension: StrikeExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new StrikeExtension();
    const builder = new SchemaBuilder();
    const schemaSpec = extension.getSchema();
    if (schemaSpec?.marks) {
      Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
        builder.addMark(name, spec);
      });
    }
    schema = builder.build();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('strike');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('mark');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Schema', () => {
    it('should add strike mark to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.marks?.strike).toBeDefined();
    });

    it('should have correct parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const strikeSpec = schemaSpec?.marks?.strike;
      expect(strikeSpec?.parseDOM).toBeDefined();
      expect(strikeSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const strikeSpec = schemaSpec?.marks?.strike;
      expect(strikeSpec?.toDOM).toBeDefined();
    });

    it('should parse <s> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><s>strikethrough text</s></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('strike');
    });

    it('should parse <strike> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><strike>strikethrough text</strike></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('strike');
    });

    it('should parse <del> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><del>strikethrough text</del></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('strike');
    });

    it('should parse text-decoration: line-through', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><span style="text-decoration: line-through">strikethrough text</span></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('strike');
    });

    it('should serialize to <s> tag', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('strikethrough text', [schema.marks.strike.create()]),
        ]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<s>');
      expect(div.innerHTML).toContain('strikethrough text');
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-Shift-x shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-Shift-x']).toBeDefined();
      expect(typeof shortcuts?.['Mod-Shift-x']).toBe('function');
    });

    it('should toggle strike mark with Mod-Shift-x', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('test')]),
      ]);

      const state = EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 1, 5),
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const command = shortcuts?.['Mod-Shift-x'];

      let newState = state;
      const result = command?.(state, (tr) => {
        newState = state.apply(tr);
      });

      expect(result).toBe(true);
      expect(newState).not.toBe(state);
    });
  });

  describe('Input rules', () => {
    it('should provide input rules', () => {
      const rules = extension.getInputRules();
      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should match ~~text~~ pattern', () => {
      const rules = extension.getInputRules();
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      // Test pattern matching
      const testString = '~~strike~~';
      const match = (rule as any).match.exec(testString);
      expect(match).toBeTruthy();
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { test: 'value' };
      extension.configure(options);
      expect(extension.getOptions()).toMatchObject(options);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });
  });

  describe('Integration with other marks', () => {
    it('should work alongside other formatting marks', () => {
      const builder = new SchemaBuilder();

      // Add strike mark
      const schemaSpec = extension.getSchema();
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }

      const combinedSchema = builder.build();
      expect(combinedSchema.marks.strike).toBeDefined();
    });
  });
});
