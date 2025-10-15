import type { NodeSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

export class TableRowExtension extends Extension {
  readonly name = 'table_row';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        table_row: {
          content: '(table_cell | table_header)*',
          tableRole: 'row',
          parseDOM: [{ tag: 'tr' }],
          toDOM: () => ['tr', 0],
        } as NodeSpec,
      },
    };
  }
}
