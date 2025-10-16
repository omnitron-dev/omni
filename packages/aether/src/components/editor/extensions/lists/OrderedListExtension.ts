/**
 * Ordered List Extension for the Advanced Editor
 *
 * Provides numbered (ordered) list functionality with markdown-style input rules.
 */

import { wrappingInputRule } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';
import type { NodeSpec, Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import { Extension } from '../../core/Extension.js';

/**
 * Ordered list node extension
 *
 * Creates numbered lists (ol) with markdown-style input rules.
 * Type `1. ` at the start of a line to create an ordered list.
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new ListItemExtension(),
 *     new OrderedListExtension(),
 *   ],
 * });
 * ```
 */
export class OrderedListExtension extends Extension {
  readonly name = 'ordered_list';
  readonly type = 'node' as const;

  get dependencies(): string[] {
    return ['list_item'];
  }

  getSchema() {
    return {
      nodes: {
        ordered_list: {
          attrs: { order: { default: 1 } },
          content: 'list_item+',
          group: 'block',
          parseDOM: [
            {
              tag: 'ol',
              getAttrs: (dom) => {
                const element = dom as HTMLElement;
                const start = element.getAttribute('start');
                return {
                  order: start ? parseInt(start, 10) : 1,
                };
              },
            },
          ],
          toDOM: (node) =>
            node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      orderedList: (): Command => (state, dispatch) =>
        wrapInList(state.schema.nodes.ordered_list)(state, dispatch),
      toggleOrderedList: (): Command => (state, dispatch) => {
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to);

        if (!range) return false;

        const orderedListNode = state.schema.nodes.ordered_list;

        // Check if we're already in an ordered list
        for (let d = range.depth; d >= 0; d--) {
          const node = range.parent;
          if (node.type === orderedListNode) {
            // Already in an ordered list, unwrap it
            return this.unwrapList()(state, dispatch);
          }
        }

        // Not in an ordered list, wrap in one
        return wrapInList(orderedListNode)(state, dispatch);
      },
    };
  }

  getInputRules(schema: Schema): InputRule[] {
    const orderedListNode = schema.nodes.ordered_list;
    if (!orderedListNode) return [];

    return [
      wrappingInputRule(
        /^(\d+)\.\s$/,
        orderedListNode,
        (match) => ({ order: parseInt(match[1], 10) }),
        (match, node) => node.childCount + node.attrs.order === parseInt(match[1], 10),
      ),
    ];
  }

  /**
   * Helper command to unwrap a list
   * @private
   */
  private unwrapList(): Command {
    return (state, dispatch) => {
      const { $from, $to } = state.selection;
      const range = $from.blockRange($to);

      if (!range) return false;

      const orderedListNode = state.schema.nodes.ordered_list;

      // Find the list wrapper
      for (let d = range.depth; d >= 0; d--) {
        const node = range.$from.node(d);
        if (node.type === orderedListNode) {
          if (dispatch) {
            const tr = state.tr;
            // Lift the list items out of the list
            tr.lift(range, d);
            dispatch(tr);
          }
          return true;
        }
      }

      return false;
    };
  }
}
