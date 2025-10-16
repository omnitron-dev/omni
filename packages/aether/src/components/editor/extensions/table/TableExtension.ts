import type { NodeSpec } from 'prosemirror-model';
import {
  tableEditing,
  goToNextCell,
  addColumnAfter,
  addColumnBefore,
  deleteColumn,
  addRowAfter,
  addRowBefore,
  deleteRow,
  mergeCells,
  splitCell,
  deleteTable,
} from 'prosemirror-tables';
import { Extension } from '../../core/Extension.js';

export interface TableOptions {
  resizable?: boolean;
  HTMLAttributes?: Record<string, any>;
}

export class TableExtension extends Extension<TableOptions> {
  readonly name = 'table';
  readonly type = 'node' as const;

  get dependencies(): string[] {
    return ['table_row', 'table_cell', 'table_header'];
  }

  protected defaultOptions(): TableOptions {
    return {
      resizable: true,
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        table: {
          content: 'table_row+',
          tableRole: 'table',
          isolating: true,
          group: 'block',
          parseDOM: [{ tag: 'table' }],
          toDOM: () => ['table', this.options.HTMLAttributes, ['tbody', 0]],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      insertTable:
        (rows: number = 3, cols: number = 3) =>
        (state, dispatch) => {
          const { schema, tr, selection } = state;
          const { $from } = selection;

          const tableType = schema.nodes.table;
          const rowType = schema.nodes.table_row;
          const cellType = schema.nodes.table_cell;

          if (!tableType || !rowType || !cellType) {
            return false;
          }

          const cells = [];
          for (let i = 0; i < cols; i++) {
            cells.push(cellType.createAndFill());
          }

          const rowNodes = [];
          for (let i = 0; i < rows; i++) {
            rowNodes.push(rowType.create(null, cells));
          }

          const table = tableType.create(null, rowNodes);

          if (dispatch) {
            const pos = $from.after();
            dispatch(tr.insert(pos, table));
          }

          return true;
        },

      deleteTable: () => (state, dispatch) => deleteTable(state, dispatch),

      addColumnBefore: () => (state, dispatch) => addColumnBefore(state, dispatch),

      addColumnAfter: () => (state, dispatch) => addColumnAfter(state, dispatch),

      deleteColumn: () => (state, dispatch) => deleteColumn(state, dispatch),

      addRowBefore: () => (state, dispatch) => addRowBefore(state, dispatch),

      addRowAfter: () => (state, dispatch) => addRowAfter(state, dispatch),

      deleteRow: () => (state, dispatch) => deleteRow(state, dispatch),

      mergeCells: () => (state, dispatch) => mergeCells(state, dispatch),

      splitCell: () => (state, dispatch) => splitCell(state, dispatch),
    };
  }

  getKeyboardShortcuts() {
    return {
      Tab: goToNextCell(1),
      'Shift-Tab': goToNextCell(-1),
    };
  }

  getPlugins() {
    return [tableEditing()];
  }
}
