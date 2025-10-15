/**
 * ImageExtension tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { ImageExtension } from '../../../../../src/components/editor/extensions/media/ImageExtension.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';

describe('ImageExtension', () => {
  let extension: ImageExtension;
  let schema: Schema;

  beforeEach(() => {
    extension = new ImageExtension();
    const builder = new SchemaBuilder();
    const schemaSpec = extension.getSchema();
    if (schemaSpec?.nodes) {
      Object.entries(schemaSpec.nodes).forEach(([name, spec]) => {
        builder.addNode(name, spec);
      });
    }
    schema = builder.build();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('image');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Default options', () => {
    it('should be block by default', () => {
      const options = extension.getOptions();
      expect(options.inline).toBe(false);
    });

    it('should allow base64 by default', () => {
      const options = extension.getOptions();
      expect(options.allowBase64).toBe(true);
    });

    it('should have empty HTMLAttributes by default', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });

    it('should not have uploadImage by default', () => {
      const options = extension.getOptions();
      expect(options.uploadImage).toBeUndefined();
    });
  });

  describe('Schema', () => {
    it('should add image node to schema', () => {
      const schemaSpec = extension.getSchema();
      expect(schemaSpec).toBeDefined();
      expect(schemaSpec?.nodes?.image).toBeDefined();
    });

    it('should have required attributes', () => {
      const schemaSpec = extension.getSchema();
      const imageSpec = schemaSpec?.nodes?.image;
      expect(imageSpec?.attrs).toBeDefined();
      expect(imageSpec?.attrs?.src).toBeDefined();
      expect(imageSpec?.attrs?.alt).toBeDefined();
      expect(imageSpec?.attrs?.title).toBeDefined();
      expect(imageSpec?.attrs?.width).toBeDefined();
      expect(imageSpec?.attrs?.height).toBeDefined();
    });

    it('should be block by default', () => {
      const schemaSpec = extension.getSchema();
      const imageSpec = schemaSpec?.nodes?.image;
      expect(imageSpec?.inline).toBe(false);
      expect(imageSpec?.group).toBe('block');
    });

    it('should be inline when configured', () => {
      extension.configure({ inline: true });
      const schemaSpec = extension.getSchema();
      const imageSpec = schemaSpec?.nodes?.image;
      expect(imageSpec?.inline).toBe(true);
      expect(imageSpec?.group).toBe('inline');
    });

    it('should be draggable', () => {
      const schemaSpec = extension.getSchema();
      const imageSpec = schemaSpec?.nodes?.image;
      expect(imageSpec?.draggable).toBe(true);
    });

    it('should have parseDOM rules', () => {
      const schemaSpec = extension.getSchema();
      const imageSpec = schemaSpec?.nodes?.image;
      expect(imageSpec?.parseDOM).toBeDefined();
      expect(imageSpec?.parseDOM?.length).toBeGreaterThan(0);
    });

    it('should have toDOM rule', () => {
      const schemaSpec = extension.getSchema();
      const imageSpec = schemaSpec?.nodes?.image;
      expect(imageSpec?.toDOM).toBeDefined();
    });

    it('should parse <img> tag with src', () => {
      const dom = document.createElement('div');
      dom.innerHTML = '<img src="https://example.com/image.jpg" />';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const imageNode = doc.firstChild;
      expect(imageNode?.type.name).toBe('image');
      expect(imageNode?.attrs.src).toBe('https://example.com/image.jpg');
    });

    it('should parse <img> with all attributes', () => {
      const dom = document.createElement('div');
      dom.innerHTML =
        '<img src="https://example.com/image.jpg" alt="Test" title="Test Image" width="100" height="200" />';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(dom);

      const imageNode = doc.firstChild;
      expect(imageNode?.type.name).toBe('image');
      expect(imageNode?.attrs.src).toBe('https://example.com/image.jpg');
      expect(imageNode?.attrs.alt).toBe('Test');
      expect(imageNode?.attrs.title).toBe('Test Image');
      expect(imageNode?.attrs.width).toBe('100');
      expect(imageNode?.attrs.height).toBe('200');
    });

    it('should serialize to <img> tag', () => {
      const doc = schema.node('doc', null, [
        schema.nodes.image.create({
          src: 'https://example.com/image.jpg',
          alt: 'Test',
        }),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('<img');
      expect(div.innerHTML).toContain('src="https://example.com/image.jpg"');
      expect(div.innerHTML).toContain('alt="Test"');
    });

    it('should serialize with dimensions', () => {
      const doc = schema.node('doc', null, [
        schema.nodes.image.create({
          src: 'https://example.com/image.jpg',
          width: 100,
          height: 200,
        }),
      ]);

      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeFragment(doc.content);
      const div = document.createElement('div');
      div.appendChild(dom);

      expect(div.innerHTML).toContain('width="100"');
      expect(div.innerHTML).toContain('height="200"');
    });
  });

  describe('Commands', () => {
    describe('insertImage', () => {
      it('should provide insertImage command', () => {
        const commands = extension.getCommands();
        expect(commands).toBeDefined();
        expect(commands.insertImage).toBeDefined();
        expect(typeof commands.insertImage).toBe('function');
      });

      it('should insert image node', () => {
        const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1),
        });

        const commands = extension.getCommands();
        const command = commands.insertImage({ src: 'https://example.com/image.jpg' });

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);
        expect(newState).not.toBe(state);
      });

      it('should insert image with all attributes', () => {
        const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1),
        });

        const commands = extension.getCommands();
        const command = commands.insertImage({
          src: 'https://example.com/image.jpg',
          alt: 'Test image',
          title: 'Test title',
          width: 100,
          height: 200,
        });

        let newState = state;
        command(state, (tr) => {
          newState = state.apply(tr);
        });

        const imageNode = newState.doc.nodeAt(0);
        expect(imageNode?.attrs.src).toBe('https://example.com/image.jpg');
        expect(imageNode?.attrs.alt).toBe('Test image');
        expect(imageNode?.attrs.title).toBe('Test title');
        expect(imageNode?.attrs.width).toBe(100);
        expect(imageNode?.attrs.height).toBe(200);
      });

      it('should return false when src is empty', () => {
        const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1),
        });

        const commands = extension.getCommands();
        const command = commands.insertImage({ src: '' });

        const result = command(state, (tr) => {});

        expect(result).toBe(false);
      });
    });

    describe('setImageSize', () => {
      it('should provide setImageSize command', () => {
        const commands = extension.getCommands();
        expect(commands.setImageSize).toBeDefined();
        expect(typeof commands.setImageSize).toBe('function');
      });

      it('should update image dimensions', () => {
        const doc = schema.node('doc', null, [
          schema.nodes.image.create({
            src: 'https://example.com/image.jpg',
            width: 100,
            height: 200,
          }),
        ]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 0),
        });

        const commands = extension.getCommands();
        const command = commands.setImageSize(300, 400);

        let newState = state;
        const result = command(state, (tr) => {
          newState = state.apply(tr);
        });

        expect(result).toBe(true);

        const imageNode = newState.doc.nodeAt(0);
        expect(imageNode?.attrs.width).toBe(300);
        expect(imageNode?.attrs.height).toBe(400);
      });

      it('should return false when not on image node', () => {
        const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

        const state = EditorState.create({
          schema,
          doc,
          selection: TextSelection.create(doc, 1),
        });

        const commands = extension.getCommands();
        const command = commands.setImageSize(300, 400);

        const result = command(state, (tr) => {});

        expect(result).toBe(false);
      });
    });
  });

  describe('Plugins', () => {
    it('should provide plugins', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBeGreaterThan(0);
    });

    it('should include drop and paste handlers', () => {
      const plugins = extension.getPlugins();
      expect(plugins.length).toBe(2); // drop and paste
    });

    describe('Drop handler', () => {
      it('should handle image drop', () => {
        const plugins = extension.getPlugins();
        const dropPlugin = plugins[0];

        const mockFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
        const mockDataTransfer = {
          files: [mockFile],
        };

        const mockView = {
          state: {
            schema,
            tr: { insert: vi.fn() },
          },
          dispatch: vi.fn(),
          posAtCoords: vi.fn(() => ({ pos: 0 })),
        } as any;

        const mockEvent = {
          dataTransfer: mockDataTransfer,
          preventDefault: vi.fn(),
          clientX: 100,
          clientY: 100,
        } as any;

        const handleDrop = dropPlugin.props.handleDrop;
        if (handleDrop) {
          const result = handleDrop(mockView, mockEvent, null as any, false);
          expect(result).toBe(true);
          expect(mockEvent.preventDefault).toHaveBeenCalled();
        }
      });

      it('should return false for moved content', () => {
        const plugins = extension.getPlugins();
        const dropPlugin = plugins[0];

        const mockView = {} as any;
        const mockEvent = { dataTransfer: { files: [] } } as any;

        const handleDrop = dropPlugin.props.handleDrop;
        if (handleDrop) {
          const result = handleDrop(mockView, mockEvent, null as any, true);
          expect(result).toBe(false);
        }
      });

      it('should return false when no image files', () => {
        const plugins = extension.getPlugins();
        const dropPlugin = plugins[0];

        const mockFile = new File([''], 'test.txt', { type: 'text/plain' });
        const mockDataTransfer = {
          files: [mockFile],
        };

        const mockView = {} as any;
        const mockEvent = {
          dataTransfer: mockDataTransfer,
        } as any;

        const handleDrop = dropPlugin.props.handleDrop;
        if (handleDrop) {
          const result = handleDrop(mockView, mockEvent, null as any, false);
          expect(result).toBe(false);
        }
      });
    });

    describe('Paste handler', () => {
      it('should handle image paste', () => {
        const plugins = extension.getPlugins();
        const pastePlugin = plugins[1];

        const mockFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
        const mockItem = {
          type: 'image/jpeg',
          getAsFile: vi.fn(() => mockFile),
        };

        const mockClipboardData = {
          items: [mockItem],
        };

        const mockView = {
          state: {
            schema,
            tr: { replaceSelectionWith: vi.fn() },
          },
          dispatch: vi.fn(),
        } as any;

        const mockEvent = {
          clipboardData: mockClipboardData,
          preventDefault: vi.fn(),
        } as any;

        const handlePaste = pastePlugin.props.handlePaste;
        if (handlePaste) {
          const result = handlePaste(mockView, mockEvent, null as any);
          expect(result).toBe(true);
          expect(mockEvent.preventDefault).toHaveBeenCalled();
        }
      });

      it('should return false when no image items', () => {
        const plugins = extension.getPlugins();
        const pastePlugin = plugins[1];

        const mockItem = {
          type: 'text/plain',
          getAsFile: vi.fn(() => null),
        };

        const mockClipboardData = {
          items: [mockItem],
        };

        const mockView = {} as any;
        const mockEvent = {
          clipboardData: mockClipboardData,
        } as any;

        const handlePaste = pastePlugin.props.handlePaste;
        if (handlePaste) {
          const result = handlePaste(mockView, mockEvent, null as any);
          expect(result).toBe(false);
        }
      });
    });

    describe('Upload integration', () => {
      it('should call uploadImage when provided', async () => {
        const uploadImage = vi.fn(async (file: File) => 'https://uploaded.com/image.jpg');
        extension.configure({ uploadImage });

        const plugins = extension.getPlugins();
        const dropPlugin = plugins[0];

        const mockFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
        const mockDataTransfer = {
          files: [mockFile],
        };

        const mockView = {
          state: {
            schema,
            tr: { insert: vi.fn() },
          },
          dispatch: vi.fn(),
          posAtCoords: vi.fn(() => ({ pos: 0 })),
        } as any;

        const mockEvent = {
          dataTransfer: mockDataTransfer,
          preventDefault: vi.fn(),
          clientX: 100,
          clientY: 100,
        } as any;

        const handleDrop = dropPlugin.props.handleDrop;
        if (handleDrop) {
          handleDrop(mockView, mockEvent, null as any, false);

          // Wait for async upload
          await new Promise((resolve) => setTimeout(resolve, 10));

          expect(uploadImage).toHaveBeenCalledWith(mockFile);
        }
      });
    });
  });

  describe('Extension lifecycle', () => {
    it('should configure with options', () => {
      const options = { inline: true, allowBase64: false };
      extension.configure(options);
      expect(extension.getOptions().inline).toBe(true);
      expect(extension.getOptions().allowBase64).toBe(false);
    });

    it('should handle editor instance', () => {
      const mockEditor = {} as any;
      extension.setEditor(mockEditor);
      expect(() => extension.destroy()).not.toThrow();
    });
  });
});
