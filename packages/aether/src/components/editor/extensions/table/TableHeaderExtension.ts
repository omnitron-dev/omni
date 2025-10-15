import type { NodeSpec } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

export interface TableHeaderOptions {
  HTMLAttributes?: Record<string, any>;
}

export class TableHeaderExtension extends Extension<TableHeaderOptions> {
  readonly name = 'table_header';
  readonly type = 'node' as const;

  protected defaultOptions(): TableHeaderOptions {
    return {
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        table_header: {
          content: 'block+',
          attrs: {
            colspan: { default: 1 },
            rowspan: { default: 1 },
            colwidth: { default: null },
          },
          tableRole: 'header_cell',
          isolating: true,
          parseDOM: [
            {
              tag: 'th',
              getAttrs: (dom: HTMLElement) => ({
                colspan: parseInt(dom.getAttribute('colspan') || '1', 10),
                rowspan: parseInt(dom.getAttribute('rowspan') || '1', 10),
                colwidth: dom.getAttribute('colwidth')
                  ? dom.getAttribute('colwidth')!.split(',').map((w) => parseInt(w, 10))
                  : null,
              }),
            },
          ],
          toDOM: (node) => {
            const attrs: Record<string, any> = {
              ...this.options.HTMLAttributes,
            };

            if (node.attrs.colspan !== 1) {
              attrs.colspan = node.attrs.colspan;
            }

            if (node.attrs.rowspan !== 1) {
              attrs.rowspan = node.attrs.rowspan;
            }

            if (node.attrs.colwidth) {
              attrs.colwidth = node.attrs.colwidth.join(',');
              attrs.style = `width: ${node.attrs.colwidth[0]}px`;
            }

            return ['th', attrs, 0];
          },
        } as NodeSpec,
      },
    };
  }
}
