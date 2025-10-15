/**
 * Task Item Extension for the Advanced Editor
 *
 * Provides task item functionality with checkbox support for task lists.
 */

import type { NodeSpec } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

/**
 * Task item node extension
 *
 * Creates task list items (li) with checkbox state tracking.
 * Used by TaskListExtension to create interactive todo lists.
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new TaskItemExtension(),
 *     new TaskListExtension(),
 *   ],
 * });
 * ```
 */
export class TaskItemExtension extends Extension {
  readonly name = 'task_item';
  readonly type = 'node' as const;

  getSchema() {
    return {
      nodes: {
        task_item: {
          attrs: { checked: { default: false } },
          content: 'paragraph block*',
          defining: true,
          parseDOM: [
            {
              tag: 'li[data-type="task_item"]',
              getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                  checked: element.getAttribute('data-checked') === 'true',
                };
              },
            },
          ],
          toDOM: (node) => [
            'li',
            {
              'data-type': 'task_item',
              'data-checked': node.attrs.checked,
            },
            0,
          ],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      toggleTaskItem: (): Command => (state, dispatch) => {
        const { $from } = state.selection;
        const taskItemNode = state.schema.nodes.task_item;

        // Find the task_item node in the selection
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type === taskItemNode) {
            if (dispatch) {
              const pos = $from.before(d);
              const tr = state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: !node.attrs.checked,
              });
              dispatch(tr);
            }
            return true;
          }
        }

        return false;
      },
    };
  }
}
