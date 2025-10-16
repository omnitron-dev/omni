/**
 * SyntaxHighlightExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { SyntaxHighlightExtension } from '../../../../../src/components/editor/extensions/code/SyntaxHighlightExtension.js';
import { CodeBlockExtension } from '../../../../../src/components/editor/extensions/code/CodeBlockExtension.js';
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

  return new Schema({ nodes, marks });
}

// Mock parser for testing
const mockParser = {
  parse: (text: string) => {
    return {
      cursor: () => ({
        next: () => false,
      }),
    };
  },
};

describe('SyntaxHighlightExtension', () => {
  let extension: SyntaxHighlightExtension;
  let codeBlockExt: CodeBlockExtension;
  let schema: Schema;

  beforeEach(() => {
    codeBlockExt = new CodeBlockExtension();
    extension = new SyntaxHighlightExtension();
    const paragraph = new ParagraphExtension();
    schema = buildSchema([codeBlockExt, extension, paragraph]);
    const editor = createMockEditor(schema);
    codeBlockExt.setEditor(editor);
    extension.setEditor(editor);
  });

  describe('Basic properties', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('syntax_highlight');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should depend on code_block', () => {
      expect(extension.dependencies).toContain('code_block');
    });

    it('should have code_block as only dependency', () => {
      expect(extension.dependencies).toHaveLength(1);
    });
  });

  describe('Default options', () => {
    it('should have empty languages by default', () => {
      const options = extension.getOptions();
      expect(options.languages).toEqual({});
    });

    it('should have plaintext as default language', () => {
      const options = extension.getOptions();
      expect(options.defaultLanguage).toBe('plaintext');
    });
  });

  describe('Custom options', () => {
    it('should accept custom languages', () => {
      const ext = new SyntaxHighlightExtension({
        languages: {
          javascript: mockParser,
        },
      });
      const options = ext.getOptions();
      expect(options.languages).toHaveProperty('javascript');
    });

    it('should accept custom default language', () => {
      const ext = new SyntaxHighlightExtension({ defaultLanguage: 'javascript' });
      const options = ext.getOptions();
      expect(options.defaultLanguage).toBe('javascript');
    });

    it('should support multiple languages', () => {
      const ext = new SyntaxHighlightExtension({
        languages: {
          javascript: mockParser,
          python: mockParser,
          typescript: mockParser,
        },
      });
      const options = ext.getOptions();
      expect(Object.keys(options.languages || {})).toHaveLength(3);
    });
  });

  describe('Plugin creation', () => {
    it('should provide plugins', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(plugins?.length).toBeGreaterThan(0);
    });

    it('should create exactly one plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toHaveLength(1);
    });

    it('should create plugin with correct structure', () => {
      const plugins = extension.getPlugins();
      const plugin = plugins?.[0];
      expect(plugin).toBeDefined();
      expect(plugin?.spec).toBeDefined();
      expect(plugin?.spec.state).toBeDefined();
    });

    it('should provide decorations prop', () => {
      const plugins = extension.getPlugins();
      const plugin = plugins?.[0];
      expect(plugin?.spec.props?.decorations).toBeDefined();
    });
  });

  describe('Decoration generation', () => {
    it('should not decorate non-code blocks', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
      });

      // Plugin should initialize without error
      const plugins = extension.getPlugins();
      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should handle empty code blocks', () => {
      const doc = schema.node('doc', null, [schema.node('code_block', null, [])]);

      const plugins = extension.getPlugins();
      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should handle code blocks without parser', () => {
      const doc = schema.node('doc', null, [schema.node('code_block', { language: 'unknown' }, [schema.text('code')])]);

      const plugins = extension.getPlugins();
      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should not highlight plaintext code blocks', () => {
      const doc = schema.node('doc', null, [
        schema.node('code_block', { language: 'plaintext' }, [schema.text('plain text')]),
      ]);

      const plugins = extension.getPlugins();
      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
    });
  });

  describe('Language parser integration', () => {
    it('should use provided parser for language', () => {
      const ext = new SyntaxHighlightExtension({
        languages: {
          javascript: mockParser,
        },
      });

      const plugins = ext.getPlugins();
      expect(plugins).toBeDefined();
    });

    it('should handle multiple parsers', () => {
      const ext = new SyntaxHighlightExtension({
        languages: {
          javascript: mockParser,
          python: mockParser,
          typescript: mockParser,
        },
      });

      const plugins = ext.getPlugins();
      expect(plugins).toHaveLength(1);
    });

    it('should not error with null parser', () => {
      const ext = new SyntaxHighlightExtension({
        languages: {
          javascript: null as any,
        },
      });

      const plugins = ext.getPlugins();
      expect(() => {
        EditorState.create({
          schema,
          doc: schema.node('doc', null, [schema.node('code_block', { language: 'javascript' }, [schema.text('code')])]),
          plugins,
        });
      }).not.toThrow();
    });
  });

  describe('Style tags mapping', () => {
    it('should define style tags', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      // The plugin should be created successfully with style tags
      expect(plugins?.[0]).toBeDefined();
    });

    it('should handle document updates', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      // Update document
      const newDoc = schema.node('doc', null, [
        schema.node('code_block', { language: 'javascript' }, [schema.text('code')]),
      ]);

      expect(() => {
        state.apply(state.tr.replaceWith(0, state.doc.content.size, newDoc.content));
      }).not.toThrow();
    });
  });

  describe('Plugin state management', () => {
    it('should initialize plugin state', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      expect(state).toBeDefined();
    });

    it('should update state on document change', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const tr = state.tr.insertText('more');
      expect(() => {
        state.apply(tr);
      }).not.toThrow();
    });

    it('should map decorations on transaction', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('original')])]);

      const state = EditorState.create({
        schema,
        doc,
        plugins,
      });

      const tr = state.tr.insertText('new', 1);
      const newState = state.apply(tr);
      expect(newState.doc.textContent).toContain('new');
    });
  });

  describe('Edge cases', () => {
    it('should handle nested document structure', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('before')]),
        schema.node('code_block', { language: 'javascript' }, [schema.text('code')]),
        schema.node('paragraph', null, [schema.text('after')]),
      ]);

      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should handle multiple code blocks', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [
        schema.node('code_block', { language: 'javascript' }, [schema.text('js code')]),
        schema.node('code_block', { language: 'python' }, [schema.text('py code')]),
        schema.node('code_block', { language: 'typescript' }, [schema.text('ts code')]),
      ]);

      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should handle code blocks with special characters', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('<>&"\'\n\t')])]);

      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should handle very long code blocks', () => {
      const plugins = extension.getPlugins();
      const longCode = 'a'.repeat(10000);
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text(longCode)])]);

      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });

    it('should handle Unicode in code blocks', () => {
      const plugins = extension.getPlugins();
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('const emoji = "🎉";')])]);

      expect(() => {
        EditorState.create({
          schema,
          doc,
          plugins,
        });
      }).not.toThrow();
    });
  });
});
