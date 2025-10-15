/**
 * LinkExtension tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { LinkExtension } from '../../../../../src/components/editor/extensions/media/LinkExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('LinkExtension', () => {
  let extension: LinkExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new LinkExtension();
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
      expect(extension.name).toBe('link');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('mark');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should have openOnClick enabled by default', () => {
      const options = extension.getOptions();
      expect(options.openOnClick).toBe(true);
    });

    it('should have linkOnPaste enabled by default', () => {
      const options = extension.getOptions();
      expect(options.linkOnPaste).toBe(true);
    });

    it('should have default HTMLAttributes', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      });
    });

    it('should have URL validation function', () => {
      const options = extension.getOptions();
      expect(options.validate).toBeDefined();
      expect(typeof options.validate).toBe('function');
    });
  });

  describe('URL validation', () => {
    it('should validate correct URLs', () => {
      const options = extension.getOptions();
      expect(options.validate?.('https://example.com')).toBe(true);
      expect(options.validate?.('http://example.com')).toBe(true);
      expect(options.validate?.('https://example.com/path?query=value')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      const options = extension.getOptions();
      expect(options.validate?.('not a url')).toBe(false);
      expect(options.validate?.('')).toBe(false);
    });

    it('should allow custom validation function', () => {
      const customValidate = vi.fn(() => true);
      extension.configure({ validate: customValidate });

      const options = extension.getOptions();
      options.validate?.('test');

      expect(customValidate).toHaveBeenCalledWith('test');
    });
  });

  describe('Schema', () => {
    it('should add link mark to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.marks?.link).toBeDefined();
    });

    it('should have href and title attributes', () => {
      const schemaSpec = extension.getSchema();
      const linkSpec = schemaSpec?.marks?.link;
      expect(linkSpec?.attrs).toBeDefined();
      expect(linkSpec?.attrs?.href).toBeDefined();
      expect(linkSpec?.attrs?.title).toBeDefined();
    });

    it('should be non-inclusive', () => {
      const schemaSpec = extension.getSchema();
      const linkSpec = schemaSpec?.marks?.link;
      expect(linkSpec?.inclusive).toBe(false);
    });

    it('should have parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const linkSpec = schemaSpec?.marks?.link;
      expect(linkSpec?.parseDOM).toBeDefined();
      expect(linkSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const linkSpec = schemaSpec?.marks?.link;
      expect(linkSpec?.toDOM).toBeDefined();
    });

    it('should parse <a> tag with href', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><a href="https://example.com">link text</a></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('link');
      expect(textNode?.marks[0]?.attrs.href).toBe('https://example.com');
    });

    it('should parse <a> tag with href and title', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<p><a href="https://example.com" title="Example">link text</a></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.length).toBe(1);
      expect(textNode?.marks[0]?.type.name).toBe('link');
      expect(textNode?.marks[0]?.attrs.href).toBe('https://example.com');
      expect(textNode?.marks[0]?.attrs.title).toBe('Example');
    });

    it('should serialize to <a> tag', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('link text', [
            schema.marks.link.create({ href: 'https://example.com' }),
          ]),
        ]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<a');
      expect(div.innerHTML).toContain('href="https://example.com"');
      expect(div.innerHTML).toContain('link text');
    });

    it('should serialize with HTMLAttributes', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('link text', [
            schema.marks.link.create({ href: 'https://example.com' }),
          ]),
        ]),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('target="_blank"');
      expect(div.innerHTML).toContain('rel="noopener noreferrer nofollow"');
    });
  });

  describe('Commands', () => {
    describe('setLink', () => {
      it('should provide setLink command', () => {
        const commands = extension.getCommands();
        expect(commands).toBeDefined();
        expect(commands.setLink).toBeDefined();
        expect(typeof commands.setLink).toBe('function');
      });

      it('should add link mark to selection', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('test text')]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.setLink('https://example.com');

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);
        expect(newState).not.toBe(state);

        const textNode = newState.doc.firstChild?.firstChild;
        expect(textNode?.marks.length).toBe(1);
        expect(textNode?.marks[0]?.type.name).toBe('link');
        expect(textNode?.marks[0]?.attrs.href).toBe('https://example.com');
      });

      it('should add link with title', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('test text')]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.setLink('https://example.com', { title: 'Example Site' });

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);

        const textNode = newState.doc.firstChild?.firstChild;
        expect(textNode?.marks[0]?.attrs.href).toBe('https://example.com');
        expect(textNode?.marks[0]?.attrs.title).toBe('Example Site');
      });

      it('should reject invalid URLs', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('test text')]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.setLink('not a url');

        const result = command(state, (tr) => {});

        expect(result).toBe(false);
      });
    });

    describe('toggleLink', () => {
      it('should provide toggleLink command', () => {
        const commands = extension.getCommands();
        expect(commands.toggleLink).toBeDefined();
        expect(typeof commands.toggleLink).toBe('function');
      });

      it('should add link when not present', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('test text')]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.toggleLink('https://example.com');

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);

        const textNode = newState.doc.firstChild?.firstChild;
        expect(textNode?.marks.length).toBe(1);
        expect(textNode?.marks[0]?.type.name).toBe('link');
      });

      it('should remove link when present', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [
            schema.text('test text', [
              schema.marks.link.create({ href: 'https://example.com' }),
            ]),
          ]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.toggleLink();

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);

        const textNode = newState.doc.firstChild?.firstChild;
        expect(textNode?.marks.length).toBe(0);
      });

      it('should return false when no href provided and no link present', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [schema.text('test text')]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.toggleLink();

        const result = command(state, (tr) => {});

        expect(result).toBe(false);
      });
    });

    describe('unsetLink', () => {
      it('should provide unsetLink command', () => {
        const commands = extension.getCommands();
        expect(commands.unsetLink).toBeDefined();
        expect(typeof commands.unsetLink).toBe('function');
      });

      it('should remove link mark', () => {
        const doc = schema.node('doc', null, [
          schema.node('paragraph', null, [
            schema.text('test text', [
              schema.marks.link.create({ href: 'https://example.com' }),
            ]),
          ]),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1, 5),
        });

        const commands = extension.getCommands();
        const command = commands.unsetLink();

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);

        const textNode = newState.doc.firstChild?.firstChild;
        expect(textNode?.marks.length).toBe(0);
      });
    });
  });

  describe('Plugins', () => {
    it('should provide plugins', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
    });

    it('should include click handler plugin when openOnClick is true', () => {
      extension.configure({ openOnClick: true });
      const plugins = extension.getPlugins();
      expect(plugins.length).toBeGreaterThan(0);
    });

    it('should not include click handler when openOnClick is false', () => {
      extension.configure({ openOnClick: false });
      const plugins = extension.getPlugins();
      expect(plugins.length).toBe(0);
    });

    it('should handle click on link element', () => {
      const plugins = extension.getPlugins();
      const clickPlugin = plugins[0];

      // Mock window.open
      const originalOpen = window.open;
      window.open = vi.fn();

      const mockLink = document.createElement('a');
      mockLink.setAttribute('href', 'https://example.com');

      const mockView = {} as any;
      const mockEvent = { target: mockLink } as any;

      const handleClick = clickPlugin.props.handleClick;
      if (handleClick) {
        const result = handleClick(mockView, 0, mockEvent);
        expect(result).toBe(true);
        expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank');
      }

      window.open = originalOpen;
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { openOnClick: false };
      extension.configure(options);
      expect(extension.getOptions().openOnClick).toBe(false);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });
  });
});
