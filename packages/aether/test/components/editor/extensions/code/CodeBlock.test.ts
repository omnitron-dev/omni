/**
 * CodeBlockExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
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

describe('CodeBlockExtension', () => {
  let extension: CodeBlockExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new CodeBlockExtension();
    const paragraph = new ParagraphExtension();
    schema = buildSchema([extension, paragraph]);
    const editor = createMockEditor(schema);
    extension.setEditor(editor);
  });

  describe('Basic properties', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('code_block');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should have no dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have plaintext as default language', () => {
      const options = extension.getOptions();
      expect(options.defaultLanguage).toBe('plaintext');
    });

    it('should have language- as default class prefix', () => {
      const options = extension.getOptions();
      expect(options.languageClassPrefix).toBe('language-');
    });

    it('should enable exit on triple enter by default', () => {
      const options = extension.getOptions();
      expect(options.exitOnTripleEnter).toBe(true);
    });

    it('should enable exit on arrow down by default', () => {
      const options = extension.getOptions();
      expect(options.exitOnArrowDown).toBe(true);
    });

    it('should have empty HTML attributes by default', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });
  });

  describe('Custom options', () => {
    it('should accept custom default language', () => {
      const ext = new CodeBlockExtension({ defaultLanguage: 'typescript' });
      const options = ext.getOptions();
      expect(options.defaultLanguage).toBe('typescript');
    });

    it('should accept custom language class prefix', () => {
      const ext = new CodeBlockExtension({ languageClassPrefix: 'lang-' });
      const options = ext.getOptions();
      expect(options.languageClassPrefix).toBe('lang-');
    });

    it('should accept custom HTML attributes', () => {
      const ext = new CodeBlockExtension({ HTMLAttributes: { class: 'custom-code' } });
      const options = ext.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-code' });
    });

    it('should disable exit on arrow down when configured', () => {
      const ext = new CodeBlockExtension({ exitOnArrowDown: false });
      const options = ext.getOptions();
      expect(options.exitOnArrowDown).toBe(false);
    });
  });

  describe('Schema', () => {
    it('should provide code_block node spec', () => {
      const schemaContrib = extension.getSchema();
      expect(schemaContrib).toBeDefined();
      expect(schemaContrib?.nodes?.code_block).toBeDefined();
    });

    it('should have correct content model', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      expect(codeBlock?.content).toBe('text*');
      expect(codeBlock?.marks).toBe('');
      expect(codeBlock?.group).toBe('block');
      expect(codeBlock?.code).toBe(true);
      expect(codeBlock?.defining).toBe(true);
    });

    it('should have language attribute', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      expect(codeBlock?.attrs).toBeDefined();
      expect(codeBlock?.attrs?.language).toBeDefined();
      expect(codeBlock?.attrs?.language.default).toBe('plaintext');
    });

    it('should have parseDOM rule for <pre> tags', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      expect(codeBlock?.parseDOM).toBeDefined();
      expect(codeBlock?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should preserve whitespace when parsing', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      const preRule = codeBlock?.parseDOM?.find((rule: any) => rule.tag === 'pre');
      expect(preRule?.preserveWhitespace).toBe('full');
    });

    it('should have toDOM function', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      expect(codeBlock?.toDOM).toBeDefined();
    });

    it('should create correct DOM structure without language', () => {
      const node = schema.nodes.code_block.create({ language: null });
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      const dom = codeBlock?.toDOM?.(node);
      expect(dom).toEqual(['pre', {}, ['code', { class: null }, 0]]);
    });

    it('should create correct DOM structure with language', () => {
      const node = schema.nodes.code_block.create({ language: 'javascript' });
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      const dom = codeBlock?.toDOM?.(node);
      expect(dom).toEqual(['pre', {}, ['code', { class: 'language-javascript' }, 0]]);
    });

    it('should include HTML attributes in toDOM', () => {
      const ext = new CodeBlockExtension({ HTMLAttributes: { class: 'code-wrapper' } });
      const schemaContrib = ext.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      const node = schema.nodes.code_block.create({ language: 'python' });
      const dom = codeBlock?.toDOM?.(node);
      expect(dom?.[1]).toEqual({ class: 'code-wrapper' });
    });
  });

  describe('Language attribute handling', () => {
    it('should use default language when not specified', () => {
      const node = schema.nodes.code_block.create();
      expect(node.attrs.language).toBe('plaintext');
    });

    it('should accept custom language', () => {
      const node = schema.nodes.code_block.create({ language: 'typescript' });
      expect(node.attrs.language).toBe('typescript');
    });

    it('should extract language from class name in parseDOM', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      const preRule = codeBlock?.parseDOM?.find((rule: any) => rule.tag === 'pre');

      const mockPre = document.createElement('pre');
      const mockCode = document.createElement('code');
      mockCode.className = 'language-javascript';
      mockPre.appendChild(mockCode);

      const attrs = preRule?.getAttrs?.(mockPre);
      expect(attrs).toEqual({ language: 'javascript' });
    });

    it('should use default language when no class name', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      const preRule = codeBlock?.parseDOM?.find((rule: any) => rule.tag === 'pre');

      const mockPre = document.createElement('pre');
      const mockCode = document.createElement('code');
      mockPre.appendChild(mockCode);

      const attrs = preRule?.getAttrs?.(mockPre);
      expect(attrs).toEqual({ language: 'plaintext' });
    });
  });

  describe('Commands', () => {
    it('should provide setCodeBlock command', () => {
      const commands = extension.getCommands();
      expect(commands?.setCodeBlock).toBeDefined();
    });

    it('should provide toggleCodeBlock command', () => {
      const commands = extension.getCommands();
      expect(commands?.toggleCodeBlock).toBeDefined();
    });

    it('should convert paragraph to code block', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.setCodeBlock()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('code_block');
      expect(newState.doc.firstChild?.textContent).toBe('test');
    });

    it('should set language attribute on code block', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.setCodeBlock({ language: 'python' })(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.attrs.language).toBe('python');
    });

    it('should toggle code block on from paragraph', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const result = commands?.toggleCodeBlock()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('code_block');
    });

    it('should toggle code block off to paragraph', () => {
      const commands = extension.getCommands();
      const doc = schema.node('doc', null, [
        schema.node('code_block', null, [schema.text('test')]),
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

      const result = commands?.toggleCodeBlock()(state, dispatch);
      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('paragraph');
    });

    it('should preserve content when toggling', () => {
      const commands = extension.getCommands();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('preserved text')]),
        ]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      commands?.toggleCodeBlock({ language: 'javascript' })(state, dispatch);
      expect(newState.doc.firstChild?.textContent).toBe('preserved text');
    });
  });

  describe('Input rules', () => {
    it('should provide input rules', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toBeDefined();
      expect(rules?.length).toBeGreaterThan(0);
    });

    it('should have input rule for ``` syntax', () => {
      const rules = extension.getInputRules(schema);
      expect(rules).toHaveLength(1);
    });
  });

  describe('Keyboard shortcuts', () => {
    it('should provide Mod-Alt-c shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Mod-Alt-c']).toBeDefined();
    });

    it('should provide Shift-Enter shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts?.['Shift-Enter']).toBeDefined();
    });

    it('should provide ArrowDown shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts?.ArrowDown).toBeDefined();
    });

    it('should toggle code block on Mod-Alt-c', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const shortcut = shortcuts?.['Mod-Alt-c'];
      const result = shortcut?.(state, dispatch);

      expect(result).toBe(true);
      expect(newState.doc.firstChild?.type.name).toBe('code_block');
    });

    it('should insert newline on Shift-Enter in code block', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
        selection: EditorState.create({ schema, doc }).selection,
      });

      let newState = state;
      const dispatch = (tr: any) => {
        newState = state.apply(tr);
      };

      const shortcut = shortcuts?.['Shift-Enter'];
      const result = shortcut?.(state, dispatch);

      expect(result).toBe(true);
      expect(newState.doc.textContent).toContain('\n');
    });

    it('should not handle Shift-Enter outside code block', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      const shortcut = shortcuts?.['Shift-Enter'];
      const result = shortcut?.(state, null as any);

      expect(result).toBe(false);
    });

    it('should exit code block on ArrowDown at end', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('test')])]);

      // Position at end of code block (position 5: after "test")
      const state = EditorState.create({
        schema,
        doc,
      });

      // Move to end of code block
      const tr = state.tr.setSelection(
        state.selection.constructor.near(doc.resolve(5)) as any,
      );
      const stateAtEnd = state.apply(tr);

      let newState = stateAtEnd;
      const dispatch = (tr: any) => {
        newState = stateAtEnd.apply(tr);
      };

      const shortcut = shortcuts?.ArrowDown;
      const result = shortcut?.(stateAtEnd, dispatch);

      expect(result).toBe(true);
    });

    it('should not exit code block on ArrowDown in middle', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('test')])]);

      const state = EditorState.create({
        schema,
        doc,
        selection: EditorState.create({ schema, doc }).selection,
      });

      const shortcut = shortcuts?.ArrowDown;
      const result = shortcut?.(state, null as any);

      expect(result).toBe(false);
    });

    it('should not exit on ArrowDown outside code block', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      const state = EditorState.create({
        schema,
        doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]),
      });

      const shortcut = shortcuts?.ArrowDown;
      const result = shortcut?.(state, null as any);

      expect(result).toBe(false);
    });

    it('should respect exitOnArrowDown option', () => {
      const ext = new CodeBlockExtension({ exitOnArrowDown: false });
      const para = new ParagraphExtension();
      const customSchema = buildSchema([ext, para]);
      ext.setEditor(createMockEditor(customSchema));

      const shortcuts = ext.getKeyboardShortcuts();
      const doc = customSchema.node('doc', null, [
        customSchema.node('code_block', null, [customSchema.text('test')]),
      ]);

      const state = EditorState.create({
        schema: customSchema,
        doc,
      });

      const tr = state.tr.setSelection(state.selection.constructor.near(doc.resolve(5)) as any);
      const stateAtEnd = state.apply(tr);

      const shortcut = shortcuts?.ArrowDown;
      const result = shortcut?.(stateAtEnd, null as any);

      expect(result).toBe(false);
    });
  });

  describe('Whitespace preservation', () => {
    it('should preserve leading spaces', () => {
      const node = schema.nodes.code_block.create(null, schema.text('  indented'));
      expect(node.textContent).toBe('  indented');
    });

    it('should preserve trailing spaces', () => {
      const node = schema.nodes.code_block.create(null, schema.text('trailing  '));
      expect(node.textContent).toBe('trailing  ');
    });

    it('should preserve multiple consecutive spaces', () => {
      const node = schema.nodes.code_block.create(null, schema.text('a    b'));
      expect(node.textContent).toBe('a    b');
    });

    it('should preserve newlines', () => {
      const node = schema.nodes.code_block.create(null, schema.text('line1\nline2\nline3'));
      expect(node.textContent).toBe('line1\nline2\nline3');
    });

    it('should preserve tabs', () => {
      const node = schema.nodes.code_block.create(null, schema.text('\tindented'));
      expect(node.textContent).toBe('\tindented');
    });
  });

  describe('Node creation', () => {
    it('should create code_block nodes', () => {
      const node = schema.nodes.code_block.create();
      expect(node.type.name).toBe('code_block');
    });

    it('should create empty code blocks', () => {
      const node = schema.nodes.code_block.create();
      expect(node.childCount).toBe(0);
    });

    it('should create code blocks with text', () => {
      const node = schema.nodes.code_block.create(null, schema.text('console.log("hello")'));
      expect(node.textContent).toBe('console.log("hello")');
    });

    it('should not allow marks inside code blocks', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      expect(codeBlock?.marks).toBe('');
    });

    it('should only allow text content', () => {
      const schemaContrib = extension.getSchema();
      const codeBlock = schemaContrib?.nodes?.code_block;
      expect(codeBlock?.content).toBe('text*');
    });
  });
});
