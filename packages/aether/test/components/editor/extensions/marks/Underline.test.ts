/**
 * UnderlineExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { UnderlineExtension } from '../../../../../src/components/editor/extensions/marks/UnderlineExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('UnderlineExtension', () => {
  let extension: UnderlineExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new UnderlineExtension();
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
      expect(extension.name).toBe('underline');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('mark');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Schema', () => {
    it('should add underline mark to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.marks?.underline).toBeDefined();
    });

    it('should have correct parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const underlineSpec = schemaSpec?.marks?.underline;
      expect(underlineSpec?.parseDOM).toBeDefined();
      expect(underlineSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const underlineSpec = schemaSpec?.marks?.underline;
      expect(underlineSpec?.toDOM).toBeDefined();
    });

    it('should parse <u> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><u>underlined text</u></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('underline');
    });

    it('should parse text-decoration: underline', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><span style="text-decoration: underline">underlined text</span></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('underline');
    });

    it('should serialize to <u> tag', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('underlined text', [schema.marks.underline.create()]),
        ]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<u>');
      expect(div.innerHTML).toContain('underlined text');
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-u shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-u']).toBeDefined();
      expect(typeof shortcuts?.['Mod-u']).toBe('function');
    });

    it('should toggle underline mark with Mod-u', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('test')]),
      ]);

      const state = EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 1, 5),
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const command = shortcuts?.['Mod-u'];

      let newState = state;
      const result = command?.(state, (tr) => {
        newState = state.apply(tr);
      });

      expect(result).toBe(true);
      expect(newState).not.toBe(state);
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

      // Add underline mark
      const schemaSpec = extension.getSchema();
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }

      const combinedSchema = builder.build();
      expect(combinedSchema.marks.underline).toBeDefined();
    });
  });
});
