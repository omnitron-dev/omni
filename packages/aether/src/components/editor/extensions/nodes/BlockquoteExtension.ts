/**
 * BlockquoteExtension - Blockquote node for the Advanced Editor
 *
 * Supports wrapping content in blockquote elements
 */

import { wrappingInputRule } from 'prosemirror-inputrules';
import { wrapIn, lift } from 'prosemirror-commands';
import type { NodeSpec, Schema } from 'prosemirror-model';
import { Extension } from '../../core/Extension.js';

/**
 * Blockquote extension options
 */
export interface BlockquoteOptions {
  /**
   * HTML attributes to add to blockquote elements
   * @default {}
   */
  HTMLAttributes: Record<string, any>;
}

/**
 * Blockquote extension
 *
 * Adds support for HTML blockquote elements with:
 * - Keyboard shortcut: Mod-Shift-b
 * - Input rule: > at start of line
 * - Commands: blockquote(), toggleBlockquote(), wrapInBlockquote()
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new BlockquoteExtension(),
 *   ],
 * });
 *
 * // Use commands
 * editor.chain().toggleBlockquote().run(); // Toggle blockquote
 * ```
 */
export class BlockquoteExtension extends Extension<BlockquoteOptions> {
  readonly name = 'blockquote';
  readonly type = 'node' as const;

  protected defaultOptions(): BlockquoteOptions {
    return {
      HTMLAttributes: {},
    };
  }

  getSchema() {
    return {
      nodes: {
        blockquote: {
          content: 'block+',
          group: 'block',
          defining: true,
          parseDOM: [{ tag: 'blockquote' }],
          toDOM: () => ['blockquote', this.options.HTMLAttributes, 0],
        } as NodeSpec,
      },
    };
  }

  getKeyboardShortcuts() {
    return {
      'Mod-Shift-b': (state, dispatch) => {
        const blockquoteType = state.schema.nodes.blockquote;
        if (!blockquoteType) return false;

        // Check if we're already in a blockquote
        const { $from } = state.selection;
        let depth = $from.depth;
        let inBlockquote = false;

        while (depth > 0) {
          if ($from.node(depth).type === blockquoteType) {
            inBlockquote = true;
            break;
          }
          depth--;
        }

        // If in blockquote, unwrap; otherwise wrap
        if (inBlockquote) {
          return lift(state, dispatch);
        }

        return wrapIn(blockquoteType)(state, dispatch);
      },
    };
  }

  getCommands() {
    return {
      /**
       * Wrap selection in blockquote
       */
      blockquote: () => (state, dispatch) => {
        const blockquoteType = state.schema.nodes.blockquote;
        if (!blockquoteType) return false;
        return wrapIn(blockquoteType)(state, dispatch);
      },

      /**
       * Toggle blockquote - wrap if not in blockquote, unwrap if already in blockquote
       */
      toggleBlockquote: () => (state, dispatch) => {
        const blockquoteType = state.schema.nodes.blockquote;
        if (!blockquoteType) return false;

        // Check if we're already in a blockquote
        const { $from } = state.selection;
        let depth = $from.depth;
        let inBlockquote = false;

        while (depth > 0) {
          if ($from.node(depth).type === blockquoteType) {
            inBlockquote = true;
            break;
          }
          depth--;
        }

        // If in blockquote, unwrap; otherwise wrap
        if (inBlockquote) {
          return lift(state, dispatch);
        }

        return wrapIn(blockquoteType)(state, dispatch);
      },

      /**
       * Wrap selection in blockquote (alias for blockquote command)
       */
      wrapInBlockquote: () => (state, dispatch) => {
        const blockquoteType = state.schema.nodes.blockquote;
        if (!blockquoteType) return false;
        return wrapIn(blockquoteType)(state, dispatch);
      },
    };
  }

  getInputRules(schema: Schema) {
    const blockquoteType = schema.nodes.blockquote;
    if (!blockquoteType) return [];

    return [
      // Match "> " at the start of a line
      wrappingInputRule(/^\s*>\s$/, blockquoteType),
    ];
  }
}
