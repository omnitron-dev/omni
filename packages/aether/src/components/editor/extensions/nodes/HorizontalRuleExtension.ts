/**
 * HorizontalRuleExtension - Horizontal rule node for the Advanced Editor
 *
 * Adds support for horizontal rule (hr) elements
 */

import { InputRule } from 'prosemirror-inputrules';
import type { NodeSpec, Schema } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

/**
 * Horizontal rule extension options
 */
export interface HorizontalRuleOptions {
  /**
   * HTML attributes to add to hr elements
   * @default {}
   */
  HTMLAttributes: Record<string, any>;
}

/**
 * Horizontal rule extension
 *
 * Adds support for HTML horizontal rule elements (<hr>).
 * This is a leaf node (no content).
 *
 * Input rule: --- on empty line creates horizontal rule
 * Commands:
 * - horizontalRule() - Insert a horizontal rule
 * - insertHorizontalRule() - Insert a horizontal rule (alias)
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new HorizontalRuleExtension(),
 *   ],
 * });
 *
 * // Use commands
 * editor.chain().horizontalRule().run(); // Insert hr
 * ```
 */
export class HorizontalRuleExtension extends Extension<HorizontalRuleOptions> {
  readonly name = 'horizontal_rule';
  readonly type = 'node' as const;

  protected defaultOptions(): HorizontalRuleOptions {
    return {
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        horizontal_rule: {
          group: 'block',
          parseDOM: [{ tag: 'hr' }],
          toDOM: () => ['hr', this.options.HTMLAttributes],
        } as NodeSpec,
      },
    };
  }

  getCommands() {
    return {
      /**
       * Insert a horizontal rule at the current position
       */
      horizontalRule: () => (state, dispatch) => {
        const hrType = state.schema.nodes.horizontal_rule;
        if (!hrType) return false;

        if (dispatch) {
          const { $from } = state.selection;
          const tr = state.tr;

          // Find the position to insert the hr
          // We want to insert it after the current block
          const pos = $from.after();

          tr.insert(pos, hrType.create());
          dispatch(tr);
        }

        return true;
      },

      /**
       * Insert a horizontal rule (alias for horizontalRule command)
       */
      insertHorizontalRule: () => (state, dispatch) => {
        const hrType = state.schema.nodes.horizontal_rule;
        if (!hrType) return false;

        if (dispatch) {
          const { $from } = state.selection;
          const tr = state.tr;

          // Find the position to insert the hr
          const pos = $from.after();

          tr.insert(pos, hrType.create());
          dispatch(tr);
        }

        return true;
      },
    };
  }

  getInputRules(schema: Schema) {
    const hrType = schema.nodes.horizontal_rule;
    if (!hrType) return [];

    return [
      new InputRule(/^---$/, (state, match, start, end) => {
        const { tr } = state;

        // Delete the matched text (---)
        tr.delete(start, end);

        // Insert the horizontal rule
        tr.insert(start, hrType.create());

        return tr;
      }),
    ];
  }
}
