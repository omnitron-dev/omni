/**
 * BoldExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { BoldExtension } from '../../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('BoldExtension', () => {
  let extension: BoldExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new BoldExtension();
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
      expect(extension.name).toBe('bold');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('mark');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Schema', () => {
    it('should add bold mark to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.marks?.bold).toBeDefined();
    });

    it('should have correct parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const boldSpec = schemaSpec?.marks?.bold;
      expect(boldSpec?.parseDOM).toBeDefined();
      expect(boldSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const boldSpec = schemaSpec?.marks?.bold;
      expect(boldSpec?.toDOM).toBeDefined();
    });

    it('should parse <strong> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><strong>bold text</strong></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('bold');
    });

    it('should parse <b> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><b>bold text</b></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('bold');
    });

    it('should parse font-weight style', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><span style="font-weight: bold">bold text</span></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('bold');
    });

    it('should serialize to <strong> tag', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('bold text', [schema.marks.bold.create()]),
        ]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<strong>');
      expect(div.innerHTML).toContain('bold text');
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-b shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-b']).toBeDefined();
      expect(typeof shortcuts?.['Mod-b']).toBe('function');
    });

    it('should toggle bold mark with Mod-b', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('test')]),
      ]);

      const state = EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 1, 5),
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const command = shortcuts?.['Mod-b'];

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

    it('should match **text** pattern', () => {
      const rules = extension.getInputRules();
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      // Test pattern matching
      const testString = '**bold**';
      const match = (rule as any).match.exec(testString);
      expect(match).toBeTruthy();
    });

    it('should match __text__ pattern', () => {
      const rules = extension.getInputRules();
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      // Test pattern matching
      const testString = '__bold__';
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
});
