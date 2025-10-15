/**
 * TableCellExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { TableCellExtension } from '../../../../../src/components/editor/extensions/table/TableCellExtension.js';

describe('TableCellExtension', () => {
  let extension: TableCellExtension;

  beforeEach(() => {
    extension = new TableCellExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('table_cell');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('options', () => {
    it('should have default options', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });

    it('should allow custom HTML attributes', () => {
      const customExt = new TableCellExtension({
        HTMLAttributes: { class: 'custom-cell' },
      });
      const options = customExt.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-cell' });
    });

    it('should allow configuration after creation', () => {
      extension.configure({ HTMLAttributes: { class: 'configured-cell' } });
      expect(extension.getOptions().HTMLAttributes).toEqual({ class: 'configured-cell' });
    });
  });

  describe('schema', () => {
    it('should provide table_cell node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.table_cell).toBeDefined();
    });

    it('should define content as "block+"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.content).toBe('block+');
    });

    it('should have tableRole set to "cell"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.tableRole).toBe('cell');
    });

    it('should be isolating', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.isolating).toBe(true);
    });

    it('should have colspan attribute with default 1', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.attrs?.colspan).toEqual({ default: 1 });
    });

    it('should have rowspan attribute with default 1', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.attrs?.rowspan).toEqual({ default: 1 });
    });

    it('should have colwidth attribute with default null', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.attrs?.colwidth).toEqual({ default: null });
    });

    it('should parse from td tags', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_cell?.parseDOM).toBeDefined();
      expect(schema?.nodes?.table_cell?.parseDOM?.[0]?.tag).toBe('td');
    });

    it('should render to td tags', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
        expect(result[0]).toBe('td');
      }
    });
  });

  describe('attribute parsing', () => {
    it('should parse colspan attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_cell?.parseDOM?.[0];
      expect(parseDOM?.getAttrs).toBeDefined();

      const mockElement = {
        getAttribute: (name: string) => (name === 'colspan' ? '3' : null),
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs).toEqual({
        colspan: 3,
        rowspan: 1,
        colwidth: null,
      });
    });

    it('should parse rowspan attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_cell?.parseDOM?.[0];

      const mockElement = {
        getAttribute: (name: string) => (name === 'rowspan' ? '2' : null),
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs).toEqual({
        colspan: 1,
        rowspan: 2,
        colwidth: null,
      });
    });

    it('should parse colwidth attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_cell?.parseDOM?.[0];

      const mockElement = {
        getAttribute: (name: string) => (name === 'colwidth' ? '100,200' : null),
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs).toEqual({
        colspan: 1,
        rowspan: 1,
        colwidth: [100, 200],
      });
    });

    it('should default to 1 when colspan is not provided', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_cell?.parseDOM?.[0];

      const mockElement = {
        getAttribute: () => null,
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs.colspan).toBe(1);
    });

    it('should default to 1 when rowspan is not provided', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_cell?.parseDOM?.[0];

      const mockElement = {
        getAttribute: () => null,
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs.rowspan).toBe(1);
    });
  });

  describe('attribute serialization', () => {
    it('should omit colspan when it is 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toEqual({});
    });

    it('should include colspan when it is not 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 3, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('colspan', 3);
    });

    it('should omit rowspan when it is 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toEqual({});
    });

    it('should include rowspan when it is not 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 2, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('rowspan', 2);
    });

    it('should include colwidth as comma-separated string', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({
        attrs: { colspan: 1, rowspan: 1, colwidth: [100, 200] },
      } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('colwidth', '100,200');
    });

    it('should include style with width when colwidth is set', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({
        attrs: { colspan: 1, rowspan: 1, colwidth: [150] },
      } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('style', 'width: 150px');
    });

    it('should apply custom HTML attributes', () => {
      const customExt = new TableCellExtension({
        HTMLAttributes: { class: 'custom-cell', 'data-test': 'true' },
      });
      const schema = customExt.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('class', 'custom-cell');
      expect(result![1]).toHaveProperty('data-test', 'true');
    });

    it('should merge custom attributes with span attributes', () => {
      const customExt = new TableCellExtension({
        HTMLAttributes: { class: 'custom-cell' },
      });
      const schema = customExt.getSchema();
      const toDOM = schema?.nodes?.table_cell?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 2, rowspan: 3, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('class', 'custom-cell');
      expect(result![1]).toHaveProperty('colspan', 2);
      expect(result![1]).toHaveProperty('rowspan', 3);
    });
  });

  describe('content validation', () => {
    it('should require at least one block element', () => {
      const cellSchema = extension.getSchema();

      const schema = new Schema({
        nodes: {
          doc: { content: 'table_cell+' },
          text: { group: 'inline' },
          paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
          },
          ...cellSchema?.nodes,
        },
      });

      // Content is "block+" which means at least one block element
      const cellSpec = schema.nodes.table_cell.spec;
      expect(cellSpec.content).toBe('block+');

      // Creating a cell with a paragraph should succeed
      const p = schema.nodes.paragraph.create();
      const cell = schema.nodes.table_cell.create(null, p);
      expect(cell).toBeDefined();
      expect(cell.childCount).toBe(1);

      // createAndFill should automatically add required content
      const filledCell = schema.nodes.table_cell.createAndFill();
      expect(filledCell).toBeDefined();
      expect(filledCell!.childCount).toBeGreaterThan(0);
    });
  });

  describe('no extra functionality', () => {
    it('should not provide commands', () => {
      const commands = extension.getCommands?.();
      expect(commands).toBeUndefined();
    });

    it('should not provide keyboard shortcuts', () => {
      const shortcuts = extension.getKeyboardShortcuts?.();
      expect(shortcuts).toBeUndefined();
    });

    it('should not provide plugins', () => {
      const plugins = extension.getPlugins?.();
      expect(plugins).toBeUndefined();
    });

    it('should not provide input rules', () => {
      const inputRules = extension.getInputRules?.();
      expect(inputRules).toBeUndefined();
    });
  });
});
