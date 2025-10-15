/**
 * BulletListExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { BulletListExtension } from '../../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { ListItemExtension } from '../../../../../src/components/editor/extensions/lists/ListItemExtension.js';

describe('BulletListExtension', () => {
  let extension: BulletListExtension;

  beforeEach(() => {
    extension = new BulletListExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('bullet_list');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should depend on list_item', () => {
      expect(extension.dependencies).toEqual(['list_item']);
    });
  });

  describe('schema', () => {
    it('should provide bullet_list node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.bullet_list).toBeDefined();
    });

    it('should define content as "list_item+"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.bullet_list?.content).toBe('list_item+');
    });

    it('should be in block group', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.bullet_list?.group).toBe('block');
    });

    it('should parse from ul tags', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.bullet_list?.parseDOM).toEqual([{ tag: 'ul' }]);
    });

    it('should render to ul tags', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.bullet_list?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({} as any);
        expect(result).toEqual(['ul', 0]);
      }
    });
  });

  describe('commands', () => {
    it('should provide bulletList command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.bulletList).toBeDefined();
      expect(typeof commands?.bulletList).toBe('function');
    });

    it('should provide toggleBulletList command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.toggleBulletList).toBeDefined();
      expect(typeof commands?.toggleBulletList).toBe('function');
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

    it('should have input rule for markdown bullet list syntax', () => {
      const mockEditor = {
        schema: createTestSchema(),
      } as any;
      extension.setEditor(mockEditor);

      const inputRules = extension.getInputRules();
      expect(inputRules).toBeDefined();
      expect(inputRules?.length).toBeGreaterThan(0);

      // The input rule should match "- ", "* ", or "+ " at start of line
      const rule = inputRules![0];
      expect(rule).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should work with list_item extension to create complete schema', () => {
      const bulletListExt = new BulletListExtension();
      const listItemExt = new ListItemExtension();

      const bulletListSchema = bulletListExt.getSchema();
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
        ...bulletListSchema?.nodes,
      };

      const schema = new Schema({ nodes });

      expect(schema.nodes.bullet_list).toBeDefined();
      expect(schema.nodes.list_item).toBeDefined();

      // The bullet_list should accept list_item as content
      const bulletListNode = schema.nodes.bullet_list;
      expect(bulletListNode.contentMatch).toBeDefined();
    });
  });
});

/**
 * Helper to create a test schema
 */
function createTestSchema() {
  const listItemExt = new ListItemExtension();
  const bulletListExt = new BulletListExtension();

  const listItemSchema = listItemExt.getSchema();
  const bulletListSchema = bulletListExt.getSchema();

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
      ...bulletListSchema?.nodes,
    },
  });
}
