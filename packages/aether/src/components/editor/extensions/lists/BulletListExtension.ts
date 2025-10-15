/**
 * Bullet List Extension for the Advanced Editor
 *
 * Provides unordered (bullet) list functionality with markdown-style input rules.
 */

import { wrappingInputRule } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';
import type { NodeSpec } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import { Extension } from '../../core/Extension.js';

/**
 * Bullet list node extension
 *
 * Creates unordered lists (ul) with markdown-style input rules.
 * Type `- ` or `* ` at the start of a line to create a bullet list.
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new ListItemExtension(),
 *     new BulletListExtension(),
 *   ],
 * });
 * ```
 */
export class BulletListExtension extends Extension {
  readonly name = 'bullet_list';
  readonly type = 'node' as const;

  get dependencies(): string[] {
    return ['list_item'];
  }

  getSchema() {
    return {
      nodes: {
        bullet_list: {
          content: 'list_item+',
          group: 'block',
          parseDOM: [{ tag: 'ul' }],
          toDOM: () => ['ul', 0],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      bulletList: (): Command => (state, dispatch) =>
        wrapInList(state.schema.nodes.bullet_list)(state, dispatch),
      toggleBulletList: (): Command => (state, dispatch) => {
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to);

        if (!range) return false;

        const bulletListNode = state.schema.nodes.bullet_list;

        // Check if we're already in a bullet list
        for (let d = range.depth; d >= 0; d--) {
          const node = range.parent;
          if (node.type === bulletListNode) {
            // Already in a bullet list, unwrap it
            return this.unwrapList()(state, dispatch);
          }
        }

        // Not in a bullet list, wrap in one
        return wrapInList(bulletListNode)(state, dispatch);
      },
    };
  }

  getInputRules(): InputRule[] {
    return [
      wrappingInputRule(/^\s*([-+*])\s$/, this.editor!.schema.nodes.bullet_list),
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

      const bulletListNode = state.schema.nodes.bullet_list;

      // Find the list wrapper
      for (let d = range.depth; d >= 0; d--) {
        const node = range.$from.node(d);
        if (node.type === bulletListNode) {
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
