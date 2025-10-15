/**
 * ListItemExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { ListItemExtension } from '../../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { BulletListExtension } from '../../../../../src/components/editor/extensions/lists/BulletListExtension.js';

describe('ListItemExtension', () => {
  let extension: ListItemExtension;

  beforeEach(() => {
    extension = new ListItemExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('list_item');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should have no dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('schema', () => {
    it('should provide list_item node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.list_item).toBeDefined();
    });

    it('should define content as "paragraph block*"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.list_item?.content).toBe('paragraph block*');
    });

    it('should be a defining node', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.list_item?.defining).toBe(true);
    });

    it('should parse from li tags', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.list_item?.parseDOM).toEqual([{ tag: 'li' }]);
    });

    it('should render to li tags', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.list_item?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({} as any);
        expect(result).toEqual(['li', 0]);
      }
    });
  });

  describe('commands', () => {
    it('should provide sinkListItem command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.sinkListItem).toBeDefined();
      expect(typeof commands?.sinkListItem).toBe('function');
    });

    it('should provide liftListItem command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.liftListItem).toBeDefined();
      expect(typeof commands?.liftListItem).toBe('function');
    });

    it('should provide splitListItem command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.splitListItem).toBeDefined();
      expect(typeof commands?.splitListItem).toBe('function');
    });
  });

  describe('keyboard shortcuts', () => {
    it('should provide Tab shortcut for sinkListItem', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.Tab).toBeDefined();
      expect(typeof shortcuts?.Tab).toBe('function');
    });

    it('should provide Shift-Tab shortcut for liftListItem', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Shift-Tab']).toBeDefined();
      expect(typeof shortcuts?.['Shift-Tab']).toBe('function');
    });

    it('should provide Enter shortcut for splitListItem', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.Enter).toBeDefined();
      expect(typeof shortcuts?.Enter).toBe('function');
    });
  });

  describe('integration with schema', () => {
    it('should work with bullet list extension', () => {
      const listItemExt = new ListItemExtension();
      const bulletListExt = new BulletListExtension();

      const listItemSchema = listItemExt.getSchema();
      const bulletListSchema = bulletListExt.getSchema();

      // Create a basic schema with both
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

      expect(schema.nodes.list_item).toBeDefined();
      expect(schema.nodes.bullet_list).toBeDefined();
      expect(bulletListExt.dependencies).toContain('list_item');
    });
  });
});
