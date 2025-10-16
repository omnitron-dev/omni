/**
 * List Item Extension for the Advanced Editor
 *
 * Provides the list_item node type that is used by bullet lists, ordered lists, and task lists.
 * Supports nesting, splitting, and indentation controls.
 */

import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { NodeSpec } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

/**
 * List item node extension
 *
 * This extension provides the basic list_item node that is used by all list types.
 * It includes commands for:
 * - Indenting (sinking) list items
 * - Outdenting (lifting) list items
 * - Splitting list items (on Enter)
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
export class ListItemExtension extends Extension {
  readonly name = 'list_item';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        list_item: {
          content: 'paragraph block*',
          defining: true,
          parseDOM: [{ tag: 'li' }],
          toDOM: () => ['li', 0],
        } as NodeSpec,
      },
    };
  }

  getKeyboardShortcuts(): Record<string, Command> {
    return {
      Tab: (state, dispatch) => sinkListItem(state.schema.nodes.list_item)(state, dispatch),
      'Shift-Tab': (state, dispatch) => liftListItem(state.schema.nodes.list_item)(state, dispatch),
      Enter: (state, dispatch) => splitListItem(state.schema.nodes.list_item)(state, dispatch),
    };
  }

  getCommands() {
    return {
      sinkListItem: () => (state, dispatch) => sinkListItem(state.schema.nodes.list_item)(state, dispatch),
      liftListItem: () => (state, dispatch) => liftListItem(state.schema.nodes.list_item)(state, dispatch),
      splitListItem: () => (state, dispatch) => splitListItem(state.schema.nodes.list_item)(state, dispatch),
    };
  }
}
