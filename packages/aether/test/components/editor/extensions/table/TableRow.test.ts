/**
 * TableRowExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { TableRowExtension } from '../../../../../src/components/editor/extensions/table/TableRowExtension.js';

describe('TableRowExtension', () => {
  let extension: TableRowExtension;

  beforeEach(() => {
    extension = new TableRowExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('table_row');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('schema', () => {
    it('should provide table_row node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.table_row).toBeDefined();
    });

    it('should define content as "(table_cell | table_header)*"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_row?.content).toBe('(table_cell | table_header)*');
    });

    it('should have tableRole set to "row"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_row?.tableRole).toBe('row');
    });

    it('should parse from tr tags', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_row?.parseDOM).toEqual([{ tag: 'tr' }]);
    });

    it('should render to tr tags', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_row?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({} as any);
        expect(result).toEqual(['tr', 0]);
      }
    });
  });

  describe('content validation', () => {
    it('should accept cells and headers as content', () => {
      const rowSchema = extension.getSchema();

      // Create a schema with table_row and mock cells
      const schema = new Schema({
        nodes: {
          doc: { content: 'table_row+' },
          text: { group: 'inline' },
          paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
          },
          table_cell: {
            content: 'block+',
            tableRole: 'cell',
            parseDOM: [{ tag: 'td' }],
            toDOM: () => ['td', 0],
          },
          table_header: {
            content: 'block+',
            tableRole: 'header_cell',
            parseDOM: [{ tag: 'th' }],
            toDOM: () => ['th', 0],
          },
          ...rowSchema?.nodes,
        },
      });

      expect(schema.nodes.table_row).toBeDefined();
      expect(schema.nodes.table_cell).toBeDefined();
      expect(schema.nodes.table_header).toBeDefined();

      // The table_row should accept both cell types
      const rowNode = schema.nodes.table_row;
      expect(rowNode.contentMatch).toBeDefined();
    });

    it('should allow empty rows', () => {
      const rowSchema = extension.getSchema();

      const schema = new Schema({
        nodes: {
          doc: { content: 'table_row+' },
          text: { group: 'inline' },
          paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
          },
          table_cell: {
            content: 'block+',
            tableRole: 'cell',
            parseDOM: [{ tag: 'td' }],
            toDOM: () => ['td', 0],
          },
          table_header: {
            content: 'block+',
            tableRole: 'header_cell',
            parseDOM: [{ tag: 'th' }],
            toDOM: () => ['th', 0],
          },
          ...rowSchema?.nodes,
        },
      });

      // Create an empty row
      const row = schema.nodes.table_row.create();
      expect(row).toBeDefined();
      expect(row.childCount).toBe(0);
    });

    it('should allow mixed cells and headers', () => {
      const rowSchema = extension.getSchema();

      const schema = new Schema({
        nodes: {
          doc: { content: 'table_row+' },
          text: { group: 'inline' },
          paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
          },
          table_cell: {
            content: 'block+',
            tableRole: 'cell',
            parseDOM: [{ tag: 'td' }],
            toDOM: () => ['td', 0],
          },
          table_header: {
            content: 'block+',
            tableRole: 'header_cell',
            parseDOM: [{ tag: 'th' }],
            toDOM: () => ['th', 0],
          },
          ...rowSchema?.nodes,
        },
      });

      const p = schema.nodes.paragraph.create();
      const cell = schema.nodes.table_cell.create(null, p);
      const header = schema.nodes.table_header.create(null, p);

      const row = schema.nodes.table_row.create(null, [header, cell]);
      expect(row).toBeDefined();
      expect(row.childCount).toBe(2);
    });
  });

  describe('no options', () => {
    it('should not have options', () => {
      const options = extension.getOptions();
      expect(options).toEqual({});
    });

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
