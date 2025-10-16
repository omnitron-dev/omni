/**
 * ItalicExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { ItalicExtension } from '../../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('ItalicExtension', () => {
  let extension: ItalicExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new ItalicExtension();
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
      expect(extension.name).toBe('italic');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('mark');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Schema', () => {
    it('should add italic mark to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.marks?.italic).toBeDefined();
    });

    it('should have correct parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const italicSpec = schemaSpec?.marks?.italic;
      expect(italicSpec?.parseDOM).toBeDefined();
      expect(italicSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const italicSpec = schemaSpec?.marks?.italic;
      expect(italicSpec?.toDOM).toBeDefined();
    });

    it('should parse <em> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><em>italic text</em></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('italic');
    });

    it('should parse <i> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><i>italic text</i></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('italic');
    });

    it('should parse font-style: italic', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><span style="font-style: italic">italic text</span></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('italic');
    });

    it('should serialize to <em> tag', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('italic text', [schema.marks.italic.create()])]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<em>');
      expect(div.innerHTML).toContain('italic text');
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-i shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-i']).toBeDefined();
      expect(typeof shortcuts?.['Mod-i']).toBe('function');
    });

    it('should toggle italic mark with Mod-i', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 1, 5),
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const command = shortcuts?.['Mod-i'];

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
      const rules = extension.getInputRules(schema);
      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should match *text* pattern', () => {
      const rules = extension.getInputRules(schema);
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      // Test pattern matching
      const testString = ' *italic*';
      const match = (rule as any).match.exec(testString);
      expect(match).toBeTruthy();
    });

    it('should match _text_ pattern', () => {
      const rules = extension.getInputRules(schema);
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      // Test pattern matching
      const testString = ' _italic_';
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

      // Add italic mark
      const schemaSpec = extension.getSchema();
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }

      const combinedSchema = builder.build();
      expect(combinedSchema.marks.italic).toBeDefined();
    });
  });
});
