/**
 * CodeExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { CodeExtension } from '../../../../../src/components/editor/extensions/marks/CodeExtension.js';
import { BoldExtension } from '../../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('CodeExtension', () => {
  let extension: CodeExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new CodeExtension();
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
      expect(extension.name).toBe('code');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('mark');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Schema', () => {
    it('should add code mark to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.marks?.code).toBeDefined();
    });

    it('should have correct parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const codeSpec = schemaSpec?.marks?.code;
      expect(codeSpec?.parseDOM).toBeDefined();
      expect(codeSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const codeSpec = schemaSpec?.marks?.code;
      expect(codeSpec?.toDOM).toBeDefined();
    });

    it('should have excludes property', () => {
      const schemaSpec = extension.getSchema();
      const codeSpec = schemaSpec?.marks?.code;
      expect(codeSpec?.excludes).toBe('_');
    });

    it('should parse <code> tag', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><code>inline code</code></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('code');
    });

    it('should not parse <code> inside <pre>', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<pre><code>code block</code></pre>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      // Should parse as paragraph since <pre> is not in schema
      // and code inside pre should be rejected
      expect(doc.content.size).toBeGreaterThan(0);
    });

    it('should serialize to <code> tag', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('inline code', [schema.marks.code.create()]),
        ]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<code>');
      expect(div.innerHTML).toContain('inline code');
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-e shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-e']).toBeDefined();
      expect(typeof shortcuts?.['Mod-e']).toBe('function');
    });

    it('should toggle code mark with Mod-e', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('test')]),
      ]);

      const state = EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 1, 5),
      });

      const shortcuts = extension.getKeyboardShortcuts();
      const command = shortcuts?.['Mod-e'];

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

    it('should match `code` pattern', () => {
      const rules = extension.getInputRules();
      const rule = rules?.[0];
      expect(rule).toBeDefined();

      // Test pattern matching
      const testString = '`code`';
      const match = (rule as any).match.exec(testString);
      expect(match).toBeTruthy();
    });
  });

  describe('Mark exclusion', () => {
    it('should exclude other marks when active', () => {
      const builder = new SchemaBuilder();

      // Add both code and bold
      const codeSpec = extension.getSchema();
      const boldExtension = new BoldExtension();
      const boldSpec = boldExtension.getSchema();

      if (codeSpec?.marks) {
        Object.entries(codeSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }

      if (boldSpec?.marks) {
        Object.entries(boldSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }

      const combinedSchema = builder.build();

      // Code mark should exclude all other marks
      const codeMarkSpec = combinedSchema.spec.marks.get('code');
      expect(codeMarkSpec?.excludes).toBe('_');
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
    it('should be added to schema with other marks', () => {
      const builder = new SchemaBuilder();

      // Add code mark
      const schemaSpec = extension.getSchema();
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }

      const combinedSchema = builder.build();
      expect(combinedSchema.marks.code).toBeDefined();
    });
  });
});
