/**
 * OrderedListExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { OrderedListExtension } from '../../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../../src/components/editor/extensions/lists/ListItemExtension.js';

describe('OrderedListExtension', () => {
  let extension: OrderedListExtension;

  beforeEach(() => {
    extension = new OrderedListExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('ordered_list');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should depend on list_item', () => {
      expect(extension.dependencies).toEqual(['list_item']);
    });
  });

  describe('schema', () => {
    it('should provide ordered_list node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.ordered_list).toBeDefined();
    });

    it('should have order attribute with default of 1', () => {
      const schema = extension.getSchema();
      const nodeSpec = schema?.nodes?.ordered_list;
      expect(nodeSpec?.attrs).toBeDefined();
      expect(nodeSpec?.attrs?.order).toEqual({ default: 1 });
    });

    it('should define content as "list_item+"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.ordered_list?.content).toBe('list_item+');
    });

    it('should be in block group', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.ordered_list?.group).toBe('block');
    });

    it('should parse from ol tags', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.ordered_list?.parseDOM;
      expect(parseDOM).toBeDefined();
      expect(parseDOM?.length).toBeGreaterThan(0);
      expect(parseDOM?.[0].tag).toBe('ol');
      expect(typeof parseDOM?.[0].getAttrs).toBe('function');
    });

    it('should extract start attribute when parsing', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.ordered_list?.parseDOM;
      const getAttrs = parseDOM?.[0].getAttrs;

      if (getAttrs && typeof getAttrs === 'function') {
        // Mock DOM element with start attribute
        const mockElement = {
          getAttribute: (name: string) => (name === 'start' ? '5' : null),
        } as any;

        const attrs = getAttrs(mockElement);
        expect(attrs).toEqual({ order: 5 });
      }
    });

    it('should default to order 1 when no start attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.ordered_list?.parseDOM;
      const getAttrs = parseDOM?.[0].getAttrs;

      if (getAttrs && typeof getAttrs === 'function') {
        // Mock DOM element without start attribute
        const mockElement = {
          getAttribute: () => null,
        } as any;

        const attrs = getAttrs(mockElement);
        expect(attrs).toEqual({ order: 1 });
      }
    });

    it('should render to ol tags', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.ordered_list?.toDOM;
      expect(toDOM).toBeDefined();
      expect(typeof toDOM).toBe('function');
    });

    it('should render without start attr when order is 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.ordered_list?.toDOM;

      if (toDOM && typeof toDOM === 'function') {
        const node = { attrs: { order: 1 } } as any;
        const result = toDOM(node);
        expect(result).toEqual(['ol', 0]);
      }
    });

    it('should render with start attr when order is not 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.ordered_list?.toDOM;

      if (toDOM && typeof toDOM === 'function') {
        const node = { attrs: { order: 5 } } as any;
        const result = toDOM(node);
        expect(result).toEqual(['ol', { start: 5 }, 0]);
      }
    });
  });

  describe('commands', () => {
    it('should provide orderedList command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.orderedList).toBeDefined();
      expect(typeof commands?.orderedList).toBe('function');
    });

    it('should provide toggleOrderedList command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.toggleOrderedList).toBeDefined();
      expect(typeof commands?.toggleOrderedList).toBe('function');
    });
  });

  describe('input rules', () => {
    it('should provide input rules', () => {
      // Need to set editor instance first
      const mockEditor = {
        schema: createTestSchema(),
      } as any;
      extension.setEditor(mockEditor);

      const inputRules = extension.getInputRules();
      expect(inputRules).toBeDefined();
      expect(Array.isArray(inputRules)).toBe(true);
      expect(inputRules?.length).toBeGreaterThan(0);
    });

    it('should have input rule for markdown ordered list syntax', () => {
      const mockEditor = {
        schema: createTestSchema(),
      } as any;
      extension.setEditor(mockEditor);

      const inputRules = extension.getInputRules();
      expect(inputRules).toBeDefined();
      expect(inputRules?.length).toBeGreaterThan(0);

      // The input rule should match "1. " or any number followed by ". "
      const rule = inputRules![0];
      expect(rule).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should work with list_item extension to create complete schema', () => {
      const orderedListExt = new OrderedListExtension();
      const listItemExt = new ListItemExtension();

      const orderedListSchema = orderedListExt.getSchema();
      const listItemSchema = listItemExt.getSchema();

      const nodes = {
        doc: {
          content: 'block+',
        },
        text: {
          group: 'inline',
        },
        paragraph: {
          content: 'inline*',
          group: 'block',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', 0],
        },
        ...listItemSchema?.nodes,
        ...orderedListSchema?.nodes,
      };

      const schema = new Schema({ nodes });

      expect(schema.nodes.ordered_list).toBeDefined();
      expect(schema.nodes.list_item).toBeDefined();

      // The ordered_list should accept list_item as content
      const orderedListNode = schema.nodes.ordered_list;
      expect(orderedListNode.contentMatch).toBeDefined();
    });
  });
});

/**
 * Helper to create a test schema
 */
function createTestSchema() {
  const listItemExt = new ListItemExtension();
  const orderedListExt = new OrderedListExtension();

  const listItemSchema = listItemExt.getSchema();
  const orderedListSchema = orderedListExt.getSchema();

  return new Schema({
    nodes: {
      doc: {
        content: 'block+',
      },
      text: {
        group: 'inline',
      },
      paragraph: {
        content: 'inline*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0],
      },
      ...listItemSchema?.nodes,
      ...orderedListSchema?.nodes,
    },
  });
}
