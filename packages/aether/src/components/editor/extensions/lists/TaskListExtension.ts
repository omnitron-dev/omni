/**
 * Task List Extension for the Advanced Editor
 *
 * Provides task list functionality with checkboxes for interactive todo lists.
 */

import { wrappingInputRule } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';
import type { NodeSpec } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import { Extension } from '../../core/Extension.js';

/**
 * Task list node extension
 *
 * Creates task lists (ul with task items) with markdown-style input rules.
 * Type `[ ] ` at the start of a line to create a task list with an unchecked item.
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
export class TaskListExtension extends Extension {
  readonly name = 'task_list';
  readonly type = 'node' as const;

  get dependencies(): string[] {
    return ['task_item'];
  }

  getSchema() {
    return {
      nodes: {
        task_list: {
          content: 'task_item+',
          group: 'block',
          parseDOM: [{ tag: 'ul[data-type="task_list"]' }],
          toDOM: () => ['ul', { 'data-type': 'task_list' }, 0],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      taskList: (): Command => (state, dispatch) =>
        wrapInList(state.schema.nodes.task_list)(state, dispatch),
      toggleTaskList: (): Command => (state, dispatch) => {
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to);

        if (!range) return false;

        const taskListNode = state.schema.nodes.task_list;

        // Check if we're already in a task list
        for (let d = range.depth; d >= 0; d--) {
          const node = range.parent;
          if (node.type === taskListNode) {
            // Already in a task list, unwrap it
            return this.unwrapList()(state, dispatch);
          }
        }

        // Not in a task list, wrap in one
        return wrapInList(taskListNode)(state, dispatch);
      },
    };
  }

  getInputRules(): InputRule[] {
    return [
      wrappingInputRule(
        /^\s*\[\s?\]\s$/,
        this.editor!.schema.nodes.task_list,
        undefined,
        undefined,
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

      const taskListNode = state.schema.nodes.task_list;

      // Find the list wrapper
      for (let d = range.depth; d >= 0; d--) {
        const node = range.$from.node(d);
        if (node.type === taskListNode) {
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
