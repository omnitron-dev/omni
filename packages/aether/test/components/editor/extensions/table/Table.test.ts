/**
 * TableExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { TableExtension } from '../../../../../src/components/editor/extensions/table/TableExtension.js';
import { TableRowExtension } from '../../../../../src/components/editor/extensions/table/TableRowExtension.js';
import { TableCellExtension } from '../../../../../src/components/editor/extensions/table/TableCellExtension.js';
import { TableHeaderExtension } from '../../../../../src/components/editor/extensions/table/TableHeaderExtension.js';

describe('TableExtension', () => {
  let extension: TableExtension;

  beforeEach(() => {
    extension = new TableExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('table');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should depend on table_row, table_cell, and table_header', () => {
      expect(extension.dependencies).toEqual(['table_row', 'table_cell', 'table_header']);
    });
  });

  describe('options', () => {
    it('should have default options', () => {
      const options = extension.getOptions();
      expect(options.resizable).toBe(true);
      expect(options.HTMLAttributes).toEqual({});
    });

    it('should allow custom options', () => {
      const customExt = new TableExtension({
        resizable: false,
        HTMLAttributes: { class: 'custom-table' },
      });
      const options = customExt.getOptions();
      expect(options.resizable).toBe(false);
      expect(options.HTMLAttributes).toEqual({ class: 'custom-table' });
    });

    it('should allow configuration after creation', () => {
      extension.configure({ resizable: false });
      expect(extension.getOptions().resizable).toBe(false);
    });
  });

  describe('schema', () => {
    it('should provide table node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.table).toBeDefined();
    });

    it('should define content as "table_row+"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table?.content).toBe('table_row+');
    });

    it('should have tableRole set to "table"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table?.tableRole).toBe('table');
    });

    it('should be isolating', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table?.isolating).toBe(true);
    });

    it('should be in block group', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table?.group).toBe('block');
    });

    it('should parse from table tags', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table?.parseDOM).toEqual([{ tag: 'table' }]);
    });

    it('should render to table tags with tbody', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({} as any);
        expect(result).toEqual(['table', {}, ['tbody', 0]]);
      }
    });

    it('should apply custom HTML attributes', () => {
      const customExt = new TableExtension({
        HTMLAttributes: { class: 'custom-table', 'data-test': 'true' },
      });
      const schema = customExt.getSchema();
      const toDOM = schema?.nodes?.table?.toDOM;
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({} as any);
        expect(result).toEqual(['table', { class: 'custom-table', 'data-test': 'true' }, ['tbody', 0]]);
      }
    });
  });

  describe('commands', () => {
    it('should provide insertTable command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.insertTable).toBeDefined();
      expect(typeof commands?.insertTable).toBe('function');
    });

    it('should provide deleteTable command', () => {
      const commands = extension.getCommands();
      expect(commands?.deleteTable).toBeDefined();
      expect(typeof commands?.deleteTable).toBe('function');
    });

    it('should provide addColumnBefore command', () => {
      const commands = extension.getCommands();
      expect(commands?.addColumnBefore).toBeDefined();
      expect(typeof commands?.addColumnBefore).toBe('function');
    });

    it('should provide addColumnAfter command', () => {
      const commands = extension.getCommands();
      expect(commands?.addColumnAfter).toBeDefined();
      expect(typeof commands?.addColumnAfter).toBe('function');
    });

    it('should provide deleteColumn command', () => {
      const commands = extension.getCommands();
      expect(commands?.deleteColumn).toBeDefined();
      expect(typeof commands?.deleteColumn).toBe('function');
    });

    it('should provide addRowBefore command', () => {
      const commands = extension.getCommands();
      expect(commands?.addRowBefore).toBeDefined();
      expect(typeof commands?.addRowBefore).toBe('function');
    });

    it('should provide addRowAfter command', () => {
      const commands = extension.getCommands();
      expect(commands?.addRowAfter).toBeDefined();
      expect(typeof commands?.addRowAfter).toBe('function');
    });

    it('should provide deleteRow command', () => {
      const commands = extension.getCommands();
      expect(commands?.deleteRow).toBeDefined();
      expect(typeof commands?.deleteRow).toBe('function');
    });

    it('should provide mergeCells command', () => {
      const commands = extension.getCommands();
      expect(commands?.mergeCells).toBeDefined();
      expect(typeof commands?.mergeCells).toBe('function');
    });

    it('should provide splitCell command', () => {
      const commands = extension.getCommands();
      expect(commands?.splitCell).toBeDefined();
      expect(typeof commands?.splitCell).toBe('function');
    });

    it('should return command that can execute', () => {
      const commands = extension.getCommands();
      const insertTable = commands?.insertTable;
      expect(insertTable).toBeDefined();

      // Commands should be callable functions
      const cmd = insertTable!(3, 3);
      expect(typeof cmd).toBe('function');
    });
  });

  describe('keyboard shortcuts', () => {
    it('should provide Tab shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Tab']).toBeDefined();
    });

    it('should provide Shift-Tab shortcut', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(shortcuts?.['Shift-Tab']).toBeDefined();
    });

    it('should have exactly 2 keyboard shortcuts', () => {
      const shortcuts = extension.getKeyboardShortcuts();
      expect(shortcuts).toBeDefined();
      expect(Object.keys(shortcuts!).length).toBe(2);
    });
  });

  describe('plugins', () => {
    it('should provide plugins', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins!.length).toBeGreaterThan(0);
    });

    it('should provide tableEditing plugin', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(plugins!.length).toBe(1);
      // The tableEditing plugin should be present
      expect(plugins![0]).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should work with all table extensions to create complete schema', () => {
      const tableExt = new TableExtension();
      const rowExt = new TableRowExtension();
      const cellExt = new TableCellExtension();
      const headerExt = new TableHeaderExtension();

      const tableSchema = tableExt.getSchema();
      const rowSchema = rowExt.getSchema();
      const cellSchema = cellExt.getSchema();
      const headerSchema = headerExt.getSchema();

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
        ...tableSchema?.nodes,
        ...rowSchema?.nodes,
        ...cellSchema?.nodes,
        ...headerSchema?.nodes,
      };

      const schema = new Schema({ nodes });

      expect(schema.nodes.table).toBeDefined();
      expect(schema.nodes.table_row).toBeDefined();
      expect(schema.nodes.table_cell).toBeDefined();
      expect(schema.nodes.table_header).toBeDefined();
    });

    it('should create valid table structure', () => {
      const schema = createTestSchema();
      const state = EditorState.create({
        schema,
        doc: schema.nodes.doc.createAndFill(),
      });

      // Create a simple table (3x3)
      const commands = extension.getCommands();
      const insertTable = commands?.insertTable?.(3, 3);

      expect(insertTable).toBeDefined();

      // The command should be executable
      const result = insertTable!(state, undefined);
      // When dispatch is undefined, the command should return whether it can execute
      expect(typeof result).toBe('boolean');
    });
  });

  describe('table creation', () => {
    it('should create table with default size (3x3)', () => {
      const schema = createTestSchema();
      const state = EditorState.create({
        schema,
        doc: schema.nodes.doc.createAndFill(),
      });

      const commands = extension.getCommands();
      const insertTable = commands?.insertTable?.();

      expect(insertTable).toBeDefined();
      const canExecute = insertTable!(state, undefined);
      expect(canExecute).toBe(true);
    });

    it('should create table with custom size', () => {
      const schema = createTestSchema();
      const state = EditorState.create({
        schema,
        doc: schema.nodes.doc.createAndFill(),
      });

      const commands = extension.getCommands();
      const insertTable = commands?.insertTable?.(5, 4);

      expect(insertTable).toBeDefined();
      const canExecute = insertTable!(state, undefined);
      expect(canExecute).toBe(true);
    });

    it('should fail when table nodes are not available', () => {
      // Create schema without table nodes
      const schema = new Schema({
        nodes: {
          doc: { content: 'block+' },
          text: { group: 'inline' },
          paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
          },
        },
      });

      const state = EditorState.create({
        schema,
        doc: schema.nodes.doc.createAndFill(),
      });

      const commands = extension.getCommands();
      const insertTable = commands?.insertTable?.(3, 3);

      expect(insertTable).toBeDefined();
      const canExecute = insertTable!(state, undefined);
      expect(canExecute).toBe(false);
    });
  });
});

/**
 * Helper to create a test schema with all table nodes
 */
function createTestSchema() {
  const tableExt = new TableExtension();
  const rowExt = new TableRowExtension();
  const cellExt = new TableCellExtension();
  const headerExt = new TableHeaderExtension();

  const tableSchema = tableExt.getSchema();
  const rowSchema = rowExt.getSchema();
  const cellSchema = cellExt.getSchema();
  const headerSchema = headerExt.getSchema();

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
      ...tableSchema?.nodes,
      ...rowSchema?.nodes,
      ...cellSchema?.nodes,
      ...headerSchema?.nodes,
    },
  });
}
